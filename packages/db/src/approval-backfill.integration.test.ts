/**
 * The decided_at backfill (P09.05, HIGH-1).
 *
 * This is the one property that cannot be tested against the shared template, because the template
 * is built by applying every migration to an empty database — exactly the case in which a missing
 * backfill is invisible. So this file builds a bare database, applies the migrations *up to* 0055,
 * approves a card (writing a ledger row with approved_at but no decided_at), and only then applies
 * 0056. Without the backfill, ADD COLUMN with DEFAULT now() would stamp the migration instant onto
 * a row whose real decision time is older — falsified history. With it, decided_at = approved_at.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { migrate } from './migrate.ts';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/** The migration before the approval hardening — decided_at does not exist yet. */
const BEFORE_APPROVAL = '0055';

let admin: Pool;
let adminBaseUrl: string;
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
  admin = createPool({ connectionString: adminBase, max: 1 });

  database = await createBareDatabase('decidedfill');
  migratorUrl = urlFor(migratorBase, database);
  staged = stageThrough(BEFORE_APPROVAL);
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

describe('applying the approval-hardening migration to a database with approvals', () => {
  it('backfills decided_at from approved_at instead of the migration instant', async () => {
    const early = await migrate(migratorUrl, staged);
    expect(early.applied.length).toBeGreaterThan(0);
    expect(early.applied.some((name) => name.startsWith('0056'))).toBe(false);

    // One tenant, one approval — written through the 0052 door, so the row has
    // approved_at but no decided_at column yet. Inserted through the owner
    // connection because FORCE RLS would otherwise hide tenant rows.
    const orgId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    const versionId = randomUUID();
    const owner = createPool({ connectionString: urlFor(adminBaseUrl, database), max: 1 });
    let approvedAt: string;
    try {
      await owner.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
        orgId,
        `decided-${database.slice(-8)}`,
        'Decided GmbH',
      ]);
      await owner.query(
        'insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)',
        [userId, randomUUID(), 'decided@example.test', 'active'],
      );
      await owner.query(
        'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
        [orgId, randomUUID(), userId, 'owner', 'active'],
      );
      await owner.query('insert into knowledge_items (organisation_id, id) values ($1, $2)', [
        orgId,
        itemId,
      ]);
      await owner.query(
        `insert into knowledge_versions
           (organisation_id, id, item_id, version_no, title, body, source, category)
         values ($1, $2, $3, 1, 'Ruhetag', 'Montags geschlossen.', 'manual', 'Test')`,
        [orgId, versionId, itemId],
      );
      // A fixed approved_at in the past: the migration instant must NOT leak in.
      // A fixed approved_at in the past: the migration instant must NOT leak in.
      // Inserted pre-0056 shape (no role/hash columns yet — they arrive with 0056).
      const inserted = await owner.query<{ approved_at: string }>(
        `insert into knowledge_approvals
           (organisation_id, id, item_id, version_id, approved_by, approved_at)
         values ($1, $2, $3, $4, $5, '2026-01-15 10:00:00+00')
         returning approved_at::text`,
        [orgId, randomUUID(), itemId, versionId, userId],
      );
      approvedAt = inserted.rows[0]?.approved_at ?? '';
      expect(approvedAt).toContain('2026-01-15');
    } finally {
      await owner.end();
    }

    // Now the rest, including 0056 with the backfill.
    const rest = await migrate(migratorUrl);
    expect(rest.applied.some((name) => name.startsWith('0056'))).toBe(true);

    const check = createPool({ connectionString: urlFor(adminBaseUrl, database), max: 1 });
    try {
      const row = await check.query<{ decided: string; approved: string }>(
        `select decided_at::text as decided, approved_at::text as approved
         from knowledge_approvals where item_id = $1`,
        [itemId],
      );
      // The historical row keeps its TRUE decision time — not the migration instant.
      expect(row.rows[0]?.decided).toBe(row.rows[0]?.approved);
      expect(row.rows[0]?.decided).toContain('2026-01-15');
      // And the column contract holds for the future: NOT NULL + DEFAULT now().
      const contract = await check.query<{ nullable: string; def: string | null }>(
        `select is_nullable as nullable, column_default as def
         from information_schema.columns
         where table_name = 'knowledge_approvals' and column_name = 'decided_at'`,
      );
      expect(contract.rows[0]?.nullable).toBe('NO');
      expect(contract.rows[0]?.def).toContain('now()');
    } finally {
      await check.end();
    }
  }, 120_000);
});
