/**
 * The register backfill (P06.10.05, INV-10).
 *
 * This is the one property that cannot be tested against the shared template, because the template
 * is built by applying every migration to an empty database — exactly the case in which a missing
 * backfill is invisible. So this file builds a bare database, applies the migrations *up to* the one
 * before the register exists, creates tenants, and only then applies the rest.
 *
 * It matters because the window to fix a missing backfill closes on first apply: the register is
 * append-only and `organisations` cannot be enumerated by any non-superuser role, so a tenant that
 * misses registration can never be added by a later migration.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { migrate } from './migrate.ts';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/** The last migration before `audit_chain_registry` exists. */
const BEFORE_REGISTER = '0007';

let admin: Pool;
let adminBaseUrl: string;
let database: string;
let migratorUrl: string;
let staged: string;

function urlFor(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/** A directory holding only the migrations up to and including `through`. */
function stageThrough(through: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'moin-migrations-'));
  for (const file of readdirSync(MIGRATIONS)) {
    if (file.slice(0, 4) <= through) copyFileSync(join(MIGRATIONS, file), join(directory, file));
  }
  return directory;
}

beforeAll(async () => {
  const adminBase = process.env['TEST_DATABASE_ADMIN_URL'];
  if (adminBase === undefined || adminBase.length === 0) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set. It is in the example environment file, which ' +
        '`pnpm test:integration` reads.',
    );
  }
  const migratorBase = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (migratorBase === undefined || migratorBase.length === 0) {
    throw new Error(
      'TEST_DATABASE_MIGRATOR_URL is not set; it is in the example environment file.',
    );
  }

  adminBaseUrl = adminBase;
  database = `moin_t_backfill_${process.env['VITEST_WORKER_ID'] ?? '0'}_${randomBytes(4).toString('hex')}`;
  admin = createPool({ connectionString: adminBase, max: 1 });
  // eslint-disable-next-line no-restricted-syntax -- database identifier, built in this file from a fixed prefix and hex generated here.
  await admin.query(`create database "${database}"`);

  const bare = createPool({ connectionString: urlFor(adminBase, database), max: 1 });
  try {
    for (const extension of ['vector', 'pgcrypto', 'citext', 'pg_trgm']) {
      // eslint-disable-next-line no-restricted-syntax -- extension names come from a literal array in this file.
      await bare.query(`create extension if not exists ${extension}`);
    }
    await bare.query('alter schema public owner to moin_migrator');
    // eslint-disable-next-line no-restricted-syntax -- database identifier, as above.
    await bare.query(`grant create on database "${database}" to moin_migrator`);
  } finally {
    await bare.end();
  }

  migratorUrl = urlFor(migratorBase, database);
  staged = stageThrough(BEFORE_REGISTER);
}, 90_000);

afterAll(async () => {
  rmSync(staged, { recursive: true, force: true });
  await admin.query(
    'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [database],
  );
  // eslint-disable-next-line no-restricted-syntax -- database identifier, as above.
  await admin.query(`drop database if exists "${database}" with (force)`);
  await admin.end();
});

describe('applying the register migration to a database that already has tenants', () => {
  it('registers every pre-existing organisation', async () => {
    const early = await migrate(migratorUrl, staged);
    expect(early.applied.length).toBeGreaterThan(0);
    expect(early.applied.some((name) => name.startsWith('0008'))).toBe(false);

    // Three tenants that exist before the register does. Inserted through the owner connection
    // because FORCE RLS would otherwise hide them from their own owner.
    const owner = createPool({
      connectionString: urlFor(adminBaseUrl, database),
      max: 1,
    });
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    try {
      for (const [index, id] of ids.entries()) {
        await owner.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
          id,
          `pre-existing-${String(index)}`,
          `Pre-existing ${String(index)}`,
        ]);
      }
    } finally {
      await owner.end();
    }

    // Now the rest, including the one that creates the register.
    const rest = await migrate(migratorUrl);
    expect(rest.applied.some((name) => name.startsWith('0010'))).toBe(true);

    const check = createPool({
      connectionString: urlFor(adminBaseUrl, database),
      max: 1,
    });
    try {
      const registered = await check.query<{ tenant_id: string }>(
        'select tenant_id from audit_chain_registry order by tenant_id',
      );
      // Without the backfill this is empty, and every one of those tenants would be outside the
      // daily sweep permanently — the register is append-only and nothing can enumerate them later.
      expect(registered.rows.map((row) => row.tenant_id).sort()).toStrictEqual([...ids].sort());
    } finally {
      await check.end();
    }
  }, 120_000);
});
