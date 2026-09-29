/**
 * Tenant isolation, asserted against real policies (P06.02.06, INV-01, INV-02).
 *
 * These run as the **application role** — `NOBYPASSRLS`, owning nothing — because that is the role
 * that serves traffic, and because a superuser silently bypasses every policy here. A suite of
 * cross-tenant tests run as an admin passes whether or not the policies exist, which is the most
 * expensive kind of green.
 *
 * Every assertion is written as the attack rather than as the feature: not "a tenant sees its own
 * rows" but "tenant A cannot see, write, change or delete tenant B's".
 */

import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool, type Pool } from './pool.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const LOCATION_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const LOCATION_B = 'bbbbbbbb-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;

/** Runs `fn`'s SQL inside a transaction with the tenant set, exactly as `withTenant` will. */
async function asTenant<T>(
  organisationId: string,
  fn: (query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    // Transaction-local, which is what makes this safe with a pooled connection: the setting
    // cannot leak into the next checkout of the same connection.
    await client.query('select set_config($1, $2, true)', ['app.organisation_id', organisationId]);
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  database = await createTestDatabase('tenant-isolation');
  // Seeded through the migration connection: creating an organisation legitimately precedes the
  // existence of the tenant it belongs to, which is why P06.04 gives it a SECURITY DEFINER
  // function of its own rather than letting the application role do it.
  const admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  try {
    await admin.query(
      `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
      [ORG_A, ORG_B],
    );
    await admin.query(
      `insert into locations (organisation_id, id, name) values ($1, $2, 'Alpha Hamburg'), ($3, $4, 'Beta Berlin')`,
      [ORG_A, LOCATION_A, ORG_B, LOCATION_B],
    );
  } finally {
    await admin.end();
  }
  app = database.pool();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

describe('with no tenant set', () => {
  // The most important assertion in the file. Code that forgets withTenant must see nothing,
  // not everything — and `current_setting(…, true)` returning NULL is what makes that so.
  // Written out rather than looped: a table name cannot be parameterised, and interpolating one
  // into SQL is the pattern the lint rule exists to stop — including in a test, where it would
  // read as precedent.
  it('organisations is empty rather than unfiltered', async () => {
    const result = await app.query<{ n: number }>('select count(*)::int as n from organisations');
    expect(result.rows[0]?.n).toBe(0);
  });

  it('locations is empty rather than unfiltered', async () => {
    const result = await app.query<{ n: number }>('select count(*)::int as n from locations');
    expect(result.rows[0]?.n).toBe(0);
  });

  it('an insert is rejected rather than landing in no tenant', async () => {
    await expect(
      app.query(
        `insert into locations (organisation_id, id, name) values ($1, gen_random_uuid(), 'x')`,
        [ORG_A],
      ),
    ).rejects.toThrow(/row-level security/u);
  });

  it('an empty tenant setting is treated as no tenant, not as a tenant named ""', async () => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', '']);
      const result = await client.query('select count(*)::int as n from locations');
      expect((result.rows[0] as { n: number }).n).toBe(0);
      await client.query('commit');
    } finally {
      client.release();
    }
  });
});

describe('as tenant A', () => {
  it('sees only its own rows', async () => {
    const names = await asTenant(ORG_A, async (query) => {
      const result = await query('select name from locations order by name');
      return result.rows.map((row) => (row as { name: string }).name);
    });
    expect(names).toStrictEqual(['Alpha Hamburg']);
  });

  it('cannot select another tenant’s row even by its exact id', async () => {
    const count = await asTenant(ORG_A, async (query) => {
      const result = await query('select count(*)::int as n from locations where id = $1', [
        LOCATION_B,
      ]);
      return (result.rows[0] as { n: number }).n;
    });
    expect(count).toBe(0);
  });

  // Not an error — zero rows. The distinction matters: an error tells an attacker the row exists.
  it('updating another tenant’s row affects nothing and does not fail', async () => {
    const affected = await asTenant(ORG_A, async (query) => {
      const result = await query('update locations set name = $2 where id = $1 returning id', [
        LOCATION_B,
        'hijacked',
      ]);
      return result.rows.length;
    });
    expect(affected).toBe(0);

    const stillNamed = await asTenant(ORG_B, async (query) => {
      const result = await query('select name from locations where id = $1', [LOCATION_B]);
      return (result.rows[0] as { name: string } | undefined)?.name;
    });
    expect(stillNamed).toBe('Beta Berlin');
  });

  it('deleting another tenant’s row affects nothing', async () => {
    const affected = await asTenant(ORG_A, async (query) => {
      const result = await query('delete from locations where id = $1 returning id', [LOCATION_B]);
      return result.rows.length;
    });
    expect(affected).toBe(0);
  });

  // WITH CHECK. Without it the row would be written and then be invisible to its writer, which is
  // the worst of both: data in the wrong tenant that nobody can see to clean up.
  it('cannot insert a row belonging to another tenant', async () => {
    await expect(
      asTenant(ORG_A, async (query) =>
        query(
          'insert into locations (organisation_id, id, name) values ($1, gen_random_uuid(), $2)',
          [ORG_B, 'smuggled'],
        ),
      ),
    ).rejects.toThrow(/row-level security/u);
  });

  it('cannot move one of its own rows into another tenant', async () => {
    await expect(
      asTenant(ORG_A, async (query) =>
        query('update locations set organisation_id = $2 where id = $1', [LOCATION_A, ORG_B]),
      ),
    ).rejects.toThrow(/row-level security/u);
  });

  it('can write its own rows', async () => {
    const inserted = await asTenant(ORG_A, async (query) => {
      const result = await query(
        'insert into locations (organisation_id, id, name) values ($1, gen_random_uuid(), $2) returning id',
        [ORG_A, 'Alpha Altona'],
      );
      return result.rows.length;
    });
    expect(inserted).toBe(1);
  });
});

describe('the tenant setting itself', () => {
  it('does not survive the transaction that set it', async () => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', ORG_A]);
      await client.query('commit');
      // Same physical connection, next transaction: the setting must be gone, or a pooled
      // connection would carry one request's tenant into the next request's.
      const result = await client.query('select count(*)::int as n from locations');
      expect((result.rows[0] as { n: number }).n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('a malformed tenant id fails the transaction rather than matching everything', async () => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', 'not-a-uuid']);
      await expect(client.query('select count(*) from locations')).rejects.toThrow();
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('the application role itself', () => {
  it('cannot bypass row-level security', async () => {
    const result = await app.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );
    expect(result.rows[0]).toStrictEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('cannot turn a policy off', async () => {
    await expect(app.query('alter table locations disable row level security')).rejects.toThrow();
    await expect(
      app.query('drop policy locations_tenant_isolation on locations'),
    ).rejects.toThrow();
  });

  it('cannot TRUNCATE, which would empty a table past every policy', async () => {
    await expect(app.query('truncate table locations')).rejects.toThrow();
  });

  it('owns no tables', async () => {
    const result = await app.query<{ n: number }>(
      `select count(*)::int as n from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname = 'public' and pg_get_userbyid(c.relowner) = current_user`,
    );
    expect(result.rows[0]?.n).toBe(0);
  });

  it('cannot run DDL', async () => {
    await expect(
      app.query('create table should_not_exist (id uuid primary key)'),
    ).rejects.toThrow();
  });
});
