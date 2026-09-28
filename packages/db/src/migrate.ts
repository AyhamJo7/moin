/**
 * Ordered SQL migration runner (P02.04.02).
 *
 * Three properties matter more than features here:
 *
 * **One runner at a time.** A rolling deploy can start several tasks at once, and two runners
 * applying the same migration concurrently is how a schema ends up half-applied. A PostgreSQL
 * advisory lock serialises them; the losers wait and then find nothing to do.
 *
 * **Each migration in its own transaction.** If one fails, it leaves nothing behind, and the
 * bookkeeping row is written in the same transaction as the DDL — so "applied" and "recorded"
 * cannot disagree.
 *
 * **Applied migrations are immutable.** The checksum of every applied file is compared on each
 * run. Editing a migration that has already run makes production and a fresh database diverge
 * silently; this turns that into a startup failure.
 *
 * Expand/contract is a review rule, not something this runner can enforce, and
 * `scripts/check-migrations.ts` checks it statically (QG-08, INV-17).
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, type Pool } from './pool.ts';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Arbitrary but fixed: any process taking this lock is a moin migration runner. */
const ADVISORY_LOCK_KEY = 4_337_201;

const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

export function loadMigrations(directory: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const seen = new Set<string>();
  return files.map((file) => {
    const match = FILENAME.exec(file);
    if (match === null) {
      throw new Error(
        `migration "${file}" must be named NNNN_lower_snake_case.sql — ordering depends on it`,
      );
    }
    const version = match[1] ?? '';
    if (seen.has(version)) {
      throw new Error(`two migrations share version ${version}; ordering would be undefined`);
    }
    seen.add(version);
    const sql = readFileSync(join(directory, file), 'utf8');
    return {
      version,
      name: match[2] ?? '',
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
}

export async function migrate(
  connectionString: string,
  directory?: string,
): Promise<MigrationOutcome> {
  const migrations = loadMigrations(directory);
  const pool = createPool({ connectionString, max: 1, application_name: 'moin-migrate' });
  try {
    return await withAdvisoryLock(pool, async () => {
      await bootstrap(pool, migrations);
      const applied = await appliedVersions(pool);
      verifyUnchanged(migrations, applied);

      const pending = migrations.filter((migration) => !applied.has(migration.version));
      for (const migration of pending) await apply(pool, migration);
      return {
        applied: pending.map((m) => `${m.version}_${m.name}`),
        alreadyApplied: applied.size,
      };
    });
  } finally {
    await pool.end();
  }
}

/** The bookkeeping table is itself migration 0001, so it is applied outside the normal path. */
async function bootstrap(pool: Pool, migrations: readonly Migration[]): Promise<void> {
  const first = migrations[0];
  if (first === undefined) return;
  await pool.query(first.sql);
}

async function appliedVersions(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ version: string; checksum: string }>(
    'select version, checksum from schema_migrations',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function verifyUnchanged(migrations: readonly Migration[], applied: Map<string, string>): void {
  for (const migration of migrations) {
    const recorded = applied.get(migration.version);
    if (recorded !== undefined && recorded !== migration.checksum) {
      throw new Error(
        `migration ${migration.version}_${migration.name} has changed since it was applied. ` +
          'An applied migration is immutable: editing one makes an existing database and a fresh ' +
          'one diverge silently. Write a new migration instead.',
      );
    }
  }
}

async function apply(pool: Pool, migration: Migration): Promise<void> {
  const client = await pool.connect();
  const started = performance.now();
  try {
    await client.query('begin');
    await client.query(migration.sql);
    await client.query(
      `insert into schema_migrations (version, name, checksum, duration_ms)
       values ($1, $2, $3, $4)
       on conflict (version) do nothing`,
      [
        migration.version,
        migration.name,
        migration.checksum,
        Math.round(performance.now() - started),
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error(
      `migration ${migration.version}_${migration.name} failed and was rolled back: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
      { cause: error },
    );
  } finally {
    client.release();
  }
}

async function withAdvisoryLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  await pool.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await pool.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}
