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
/** The last migration before `registration_seq` exists — the register is populated by then. */
const BEFORE_SEQUENCE = '0010';

let admin: Pool;
let adminBaseUrl: string;
let migratorBaseUrl: string;
let database: string;
let migratorUrl: string;
let staged: string;
/** Every database this file created, dropped together at the end. */
const created: string[] = [];

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

/** A database with extensions and ownership set up, but no migrations applied. */
async function createBareDatabase(label: string): Promise<string> {
  const name = `moin_t_${label}_${process.env['VITEST_WORKER_ID'] ?? '0'}_${randomBytes(4).toString('hex')}`;
  // eslint-disable-next-line no-restricted-syntax -- database identifier, built here from a fixed prefix and hex generated in this file.
  await admin.query(`create database "${name}"`);
  const bare = createPool({ connectionString: urlFor(adminBaseUrl, name), max: 1 });
  try {
    for (const extension of ['vector', 'pgcrypto', 'citext', 'pg_trgm']) {
      // eslint-disable-next-line no-restricted-syntax -- extension names come from a literal array in this file.
      await bare.query(`create extension if not exists ${extension}`);
    }
    await bare.query('alter schema public owner to moin_migrator');
    // eslint-disable-next-line no-restricted-syntax -- database identifier, as above.
    await bare.query(`grant create on database "${name}" to moin_migrator`);
  } finally {
    await bare.end();
  }
  created.push(name);
  return name;
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
  migratorBaseUrl = migratorBase;
  admin = createPool({ connectionString: adminBase, max: 1 });

  database = await createBareDatabase('backfill');
  migratorUrl = urlFor(migratorBase, database);
  staged = stageThrough(BEFORE_REGISTER);
}, 90_000);

afterAll(async () => {
  rmSync(staged, { recursive: true, force: true });
  for (const name of created) {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    // eslint-disable-next-line no-restricted-syntax -- database identifier, as above.
    await admin.query(`drop database if exists "${name}" with (force)`);
  }
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

describe('applying the registration-sequence migration to a populated register', () => {
  it('backfills every existing row deterministically and keeps advancing afterwards', async () => {
    // The case a shared template cannot exercise: 0011 adds `registration_seq` to a register that
    // already has rows. If those rows were left without a sequence they would be outside every
    // sweep's population for ever, because the register is append-only and the column is NOT NULL
    // only after the backfill.
    const own = await createBareDatabase('seqfill');
    const ownMigratorUrl = urlFor(migratorBaseUrl, own);
    const stagedThroughRegister = stageThrough(BEFORE_SEQUENCE);
    try {
      // Tenants must exist before the register does, so 0010 backfills the register and 0011 then
      // finds it populated — which is the situation under test.
      const owner0 = createPool({ connectionString: urlFor(adminBaseUrl, own), max: 1 });
      try {
        await migrate(ownMigratorUrl, stageThrough(BEFORE_REGISTER));
        for (let index = 0; index < 3; index += 1) {
          await owner0.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
            randomUUID(),
            `pre-seq-${String(index)}`,
            `Pre seq ${String(index)}`,
          ]);
        }
      } finally {
        await owner0.end();
      }

      const early = await migrate(ownMigratorUrl, stagedThroughRegister);
      expect(early.applied.some((name) => name.startsWith('0010'))).toBe(true);
      expect(early.applied.some((name) => name.startsWith('0011'))).toBe(false);

      const owner = createPool({ connectionString: urlFor(adminBaseUrl, own), max: 1 });
      try {
        // The register is populated, and has no sequence column yet.
        const before = await owner.query<{ n: string }>(
          'select count(*)::text as n from audit_chain_registry',
        );
        expect(Number(before.rows[0]?.n)).toBeGreaterThan(0);
        const columns = await owner.query<{ n: string }>(
          `select count(*)::text as n from information_schema.columns
           where table_name = 'audit_chain_registry' and column_name = 'registration_seq'`,
        );
        expect(Number(columns.rows[0]?.n)).toBe(0);

        const populated = Number(before.rows[0]?.n);

        // Now the migration that adds and backfills it.
        const rest = await migrate(ownMigratorUrl);
        expect(rest.applied.some((name) => name.startsWith('0011'))).toBe(true);

        const backfilled = await owner.query<{ tenant_id: string; registration_seq: string }>(
          'select tenant_id::text, registration_seq::text from audit_chain_registry order by registration_seq',
        );
        // Every row has one, and they are 1..n with no gaps.
        expect(backfilled.rows).toHaveLength(populated);
        expect(backfilled.rows.map((row) => row.registration_seq)).toStrictEqual(
          Array.from({ length: populated }, (_, index) => String(index + 1)),
        );
        // Deterministic: assignment follows `tenant_id` order, so the same register yields the
        // same sequence numbers in every environment.
        const byTenant = [...backfilled.rows].sort((left, right) =>
          left.tenant_id.localeCompare(right.tenant_id),
        );
        expect(byTenant.map((row) => row.registration_seq)).toStrictEqual(
          backfilled.rows.map((row) => row.registration_seq),
        );

        // And the sequence continues past the backfill rather than colliding with it.
        const next = randomUUID();
        await owner.query(`insert into organisations(id, slug, name) values ($1, 'post', 'Post')`, [
          next,
        ]);
        const assigned = await owner.query<{ n: string }>(
          'select registration_seq::text as n from audit_chain_registry where tenant_id = $1',
          [next],
        );
        expect(Number(assigned.rows[0]?.n)).toBe(populated + 1);

        // The high-water mark sees the whole register.
        const mark = await owner.query<{ n: string }>(
          'select app.audit_chain_high_water()::text as n',
        );
        expect(Number(mark.rows[0]?.n)).toBe(populated + 1);
      } finally {
        await owner.end();
      }
    } finally {
      rmSync(stagedThroughRegister, { recursive: true, force: true });
    }
  }, 150_000);
});
