/**
 * The cross-tenant write matrix, generated from the live catalog (P06.02.06, INV-01, INV-02).
 *
 * The inventory is not a list in this file: it is every table that has an `organisation_id` column
 * in the migrated database, read from `pg_catalog`. A table added by a later migration is therefore
 * covered the day it exists, and a table that cannot be exercised generically must be named in
 * `UNSEEDABLE` with a reason, or the suite fails. Nothing is skipped silently.
 *
 * For each table, with a visible row of tenant A and one of tenant B, connected as `moin_app`
 * (NOSUPERUSER, NOBYPASSRLS):
 *
 *   - no tenant context      → no row is readable;
 *   - tenant A's context     → only A's rows are readable;
 *   - INSERT naming B        → refused (row-level security WITH CHECK, or no privilege);
 *   - UPDATE moving A's row to B → refused, and the row stays A's;
 *   - UPDATE and DELETE of B's rows → no row is touched, or the privilege is refused;
 *   - afterwards B's row still exists, unchanged in tenant.
 *
 * "Refused" is SQLSTATE 42501 (policy or privilege). Anything else (a constraint error, a trigger
 * error) is reported, because it would mean the write was never judged by the policy.
 */
import {
  countTenantRows,
  createTestDatabase,
  evidenceTest,
  liveTenantTables as tenantTablesIn,
  seedTenantRow,
  UNSEEDABLE,
  type TenantTable,
  type TestDatabase,
} from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase('write-matrix');
  await database.fixturePool().query(
    `INSERT INTO organisations (id, slug, name) VALUES ($1, 'matrix-a', 'Alpha'), ($2, 'matrix-b', 'Beta')
     ON CONFLICT DO NOTHING`,
    [ORG_A, ORG_B],
  );
}, 60_000);

afterAll(async () => {
  await database.drop();
});

const liveTenantTables = (): Promise<TenantTable[]> => tenantTablesIn(database.fixturePool());
const seed = (table: TenantTable, org: string): Promise<string | undefined> =>
  seedTenantRow(database.fixturePool(), table, org);
const countAsOwner = (table: TenantTable, org: string): Promise<number> =>
  countTenantRows(database.fixturePool(), table, org);

type Outcome = { refused: true } | { refused: false; rows: number } | { error: string };

/** Runs one statement as moin_app in its own transaction; 42501 is a refusal. */
async function asApp(
  org: string | null,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Outcome> {
  try {
    if (org === null) {
      const res = await database.pool().query(sql, [...params]);
      return { refused: false, rows: res.rowCount ?? res.rows.length };
    }
    return await withTenant(database.pool(), org, async (client) => {
      const res = await client.query(sql, [...params]);
      return { refused: false as const, rows: res.rowCount ?? res.rows.length };
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') return { refused: true };
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The violations found for one table; empty means every cell of the matrix held. */
async function runMatrix(table: TenantTable, seeded: boolean): Promise<string[]> {
  const t = table.qualified;
  const c = table.tenantColumn;
  const violations: string[] = [];
  const check = (cell: string, outcome: Outcome, ok: (o: Outcome) => boolean): void => {
    if (!ok(outcome)) violations.push(`${table.name} ${cell}: ${JSON.stringify(outcome)}`);
  };
  /* eslint-disable no-restricted-syntax -- every statement names a table read from pg_catalog. */
  check(
    'no context SELECT',
    await asApp(null, `SELECT 1 FROM ${t}`),
    (o) => 'refused' in o && (o.refused || o.rows === 0),
  );
  check(
    'A sees only A',
    await asApp(ORG_A, `SELECT 1 FROM ${t} WHERE ${c} <> $1`, [ORG_A]),
    (o) => 'refused' in o && (o.refused || o.rows === 0),
  );
  if (seeded) {
    const own = await asApp(ORG_A, `SELECT 1 FROM ${t} WHERE ${table.tenantColumn} = $1`, [ORG_A]);
    check(
      'A sees its own row or is refused by privilege',
      own,
      (o) => 'refused' in o && (o.refused || o.rows >= 1),
    );
  }
  check(
    'INSERT naming B from A',
    await asApp(ORG_A, `INSERT INTO ${t} (${c}) VALUES ($1)`, [ORG_B]),
    (o) => 'refused' in o && o.refused,
  );
  check(
    'UPDATE moving A to B',
    await asApp(ORG_A, `UPDATE ${t} SET ${c} = $2 WHERE ${c} = $1`, [ORG_A, ORG_B]),
    (o) => 'refused' in o && (o.refused || o.rows === 0),
  );
  check(
    'UPDATE of B from A',
    await asApp(ORG_A, `UPDATE ${t} SET ${c} = ${c} WHERE ${c} = $1`, [ORG_B]),
    (o) => 'refused' in o && (o.refused || o.rows === 0),
  );
  check(
    'DELETE of B from A',
    await asApp(ORG_A, `DELETE FROM ${t} WHERE ${table.tenantColumn} = $1`, [ORG_B]),
    (o) => 'refused' in o && (o.refused || o.rows === 0),
  );
  /* eslint-enable no-restricted-syntax */
  if (seeded) {
    if ((await countAsOwner(table, ORG_B)) !== 1) violations.push(`${table.name}: B's row changed`);
    if ((await countAsOwner(table, ORG_A)) !== 1) violations.push(`${table.name}: A's row changed`);
  }
  return violations;
}

describe('the cross-tenant write matrix follows the live catalog', () => {
  evidenceTest('every tenant table holds every cell, or is registered with a reason', async () => {
    const tables = await liveTenantTables();
    expect(tables.length).toBeGreaterThan(50);
    const unregistered: string[] = [];
    const violations: string[] = [];
    let seededTables = 0;
    for (const table of tables) {
      const reasonRegistered = UNSEEDABLE[table.name];
      let seeded = false;
      if (reasonRegistered === undefined) {
        const failures = [await seed(table, ORG_A), await seed(table, ORG_B)].filter(
          (failure) => failure !== undefined,
        );
        if (failures.length > 0) {
          unregistered.push(`${table.name}: ${failures[0] ?? ''}`);
          continue;
        }
        seeded = true;
        seededTables += 1;
      }
      violations.push(...(await runMatrix(table, seeded)));
    }
    // A table that cannot be seeded must be named, with a reason, in UNSEEDABLE.
    expect(unregistered).toStrictEqual([]);
    expect(violations).toStrictEqual([]);
    // Every registered exception is a real tenant table, and none is stale: a table that now
    // seeds generically must leave the list, so the list cannot hide a table that could be tested.
    for (const name of Object.keys(UNSEEDABLE)) {
      const table = tables.find((candidate) => candidate.name === name);
      expect(table, `UNSEEDABLE names ${name}, which is not a tenant table`).toBeDefined();
      if (table !== undefined) {
        expect(
          await seed(table, ORG_A),
          `${name} seeds now; remove it from UNSEEDABLE`,
        ).toBeDefined();
      }
    }
    expect(seededTables + Object.keys(UNSEEDABLE).length).toBe(tables.length);
  });
});

/** Weakened schemas the matrix must reject: the proof that a green run means something. */
describe('the matrix kills a weakened table', () => {
  async function ddl(sql: string): Promise<void> {
    await database.fixturePool().query(sql);
  }

  async function locations(): Promise<TenantTable> {
    const table = (await liveTenantTables()).find((candidate) => candidate.name === 'locations');
    if (table === undefined) throw new Error('locations is not a tenant table');
    return table;
  }

  async function violationsOf(table: TenantTable): Promise<string[]> {
    // A clean slate of one visible row per tenant for every control.
    await database
      .fixturePool()
      .query(`DELETE FROM locations WHERE organisation_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
    expect(await seed(table, ORG_A)).toBeUndefined();
    expect(await seed(table, ORG_B)).toBeUndefined();
    return runMatrix(table, true);
  }

  evidenceTest('the unweakened table passes, so the controls below are differences', async () => {
    expect(await violationsOf(await locations())).toStrictEqual([]);
  });

  evidenceTest('a WITH CHECK of true is a violation', async () => {
    const table = await locations();
    await ddl(`ALTER POLICY locations_tenant_isolation ON locations WITH CHECK (true)`);
    try {
      const violations = await violationsOf(table);
      expect(violations.some((v) => v.includes('INSERT naming B from A'))).toBe(true);
    } finally {
      await ddl(
        `ALTER POLICY locations_tenant_isolation ON locations WITH CHECK (organisation_id = app.current_org())`,
      );
    }
  });

  evidenceTest('a USING of true is a violation', async () => {
    const table = await locations();
    await ddl(`ALTER POLICY locations_tenant_isolation ON locations USING (true)`);
    try {
      const violations = await violationsOf(table);
      expect(violations.some((v) => v.includes('A sees only A'))).toBe(true);
    } finally {
      await ddl(
        `ALTER POLICY locations_tenant_isolation ON locations USING (organisation_id = app.current_org())`,
      );
    }
  });

  evidenceTest('row-level security switched off is a violation', async () => {
    const table = await locations();
    await ddl(`ALTER TABLE locations NO FORCE ROW LEVEL SECURITY`);
    await ddl(`ALTER TABLE locations DISABLE ROW LEVEL SECURITY`);
    try {
      const violations = await violationsOf(table);
      expect(violations.length).toBeGreaterThan(0);
    } finally {
      await ddl(`ALTER TABLE locations ENABLE ROW LEVEL SECURITY`);
      await ddl(`ALTER TABLE locations FORCE ROW LEVEL SECURITY`);
    }
  });
});
