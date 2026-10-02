/**
 * Real-PostgreSQL test harness (P02.05.02).
 *
 * **Why real Postgres, never an embedded or in-memory substitute.** The rules this project most
 * needs to test are row-level-security policies, and an embedded Postgres runs as superuser, which
 * silently bypasses RLS. A cross-tenant test would pass against it while the policy it claims to
 * verify does not exist. PLAN states this as a rule; this module is what makes following it cheap.
 *
 * **Why a template database per test file.** Tests that share one database are ordered by
 * accident: one file's leftover rows become another's fixture, and the suite passes while each
 * file fails on its own. `CREATE DATABASE … TEMPLATE …` copies a fully migrated database in
 * roughly the time of a file copy, so every file gets a private, freshly migrated database and
 * "passes standalone" stops being a separate hope.
 *
 * The template itself is built once per run by `global-setup.ts`.
 */

import { randomBytes } from 'node:crypto';
import { createPool, type Pool } from '@moin/db/pool';

export const TEMPLATE_DATABASE = 'moin_test_template';

/** Admin connection, used only to create and drop databases. */
function adminUrl(): string {
  const url = process.env['TEST_DATABASE_ADMIN_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set. It is in the example environment file, which ' +
        '`pnpm test:integration` reads — so this usually means that file has not been copied ' +
        'yet. The local stack must also be running (`pnpm dev:up`).',
    );
  }
  return url;
}

function urlForDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export interface TestDatabase {
  /** Connection string for the application role — NOBYPASSRLS, exactly as in production. */
  readonly appUrl: string;
  /** Connection string for the migration role. */
  readonly migrationUrl: string;
  readonly name: string;
  /** A pool as the application role. Closed by `drop()`. */
  pool(): Pool;
  /**
   * A pool on `migrationUrl`, for fixtures and for reading rows back. It is the admin connection
   * and bypasses row-level security, so it must never drive the behaviour under test — only set
   * the stage and inspect the result. Closed by `drop()`.
   */
  fixturePool(): Pool;
  drop(): Promise<void>;
}

/**
 * Clone the template into a private database for one test file.
 *
 * The name carries the worker id and random bytes so two parallel workers, or two runs racing on
 * the same machine, cannot collide.
 */
export async function createTestDatabase(label = 'test'): Promise<TestDatabase> {
  const admin = adminUrl();
  const suffix = randomBytes(6).toString('hex');
  const worker = process.env['VITEST_WORKER_ID'] ?? '0';
  const name = `moin_t_${sanitise(label)}_${worker}_${suffix}`;

  const adminPool = createPool({ connectionString: admin, max: 1 });
  try {
    // Identifiers cannot be parameterised, so the name is built from a sanitised label plus hex
    // this module generated — never from anything a test supplies verbatim.
    // eslint-disable-next-line no-restricted-syntax -- database identifier. `name` is built in this module from a sanitised label plus hex generated here; nothing a caller supplies reaches it verbatim.
    await adminPool.query(`create database "${name}" template "${TEMPLATE_DATABASE}"`);
  } finally {
    await adminPool.end();
  }

  let appPool: Pool | undefined;
  const appBase = process.env['TEST_DATABASE_APP_URL'];
  if (appBase === undefined || appBase.length === 0) {
    // Falling back to the admin connection used to be the default here, and it made the suite
    // fail with "a superuser silently bypasses RLS" — an assertion that reads like a genuine
    // security defect rather than a missing variable. Name the variable instead.
    throw new Error(
      'TEST_DATABASE_APP_URL is not set. Integration tests connect as the application role, not ' +
        'as the admin role, because an admin connection bypasses row-level security and would ' +
        'make every isolation test meaningless. Both connection strings are in the example ' +
        'environment file.',
    );
  }
  const appUrl = urlForDatabase(appBase, name);
  const migrationUrl = urlForDatabase(admin, name);
  let fixtures: Pool | undefined;

  return {
    name,
    appUrl,
    migrationUrl,
    pool(): Pool {
      appPool ??= createPool({ connectionString: appUrl, max: 4 });
      return appPool;
    },
    fixturePool(): Pool {
      fixtures ??= createPool({ connectionString: migrationUrl, max: 2 });
      return fixtures;
    },
    async drop(): Promise<void> {
      if (appPool !== undefined) {
        await appPool.end();
        appPool = undefined;
      }
      if (fixtures !== undefined) {
        await fixtures.end();
        fixtures = undefined;
      }
      const cleanup = createPool({ connectionString: admin, max: 1 });
      try {
        // Terminate stragglers first: DROP DATABASE fails while any connection remains, and a
        // leaked connection would otherwise leave a database behind on every run.
        await cleanup.query(
          'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
          [name],
        );
        // eslint-disable-next-line no-restricted-syntax -- database identifier. `name` is built in this module from a sanitised label plus hex generated here; nothing a caller supplies reaches it verbatim.
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Postgres identifiers are limited to 63 bytes, and only a known-safe alphabet is allowed. */
function sanitise(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}
