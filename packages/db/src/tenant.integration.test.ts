/**
 * `withTenant` and `withSystemWork` against real policies (P06.03.07, P06.14.02).
 *
 * The wrapper is only worth anything if the setting it writes is the one the policies read, in the
 * same transaction, on the same connection — and none of that can be asserted without a database
 * that has the policies. So these run against one, as the application role.
 */

import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool, type Pool } from './pool.ts';
import {
  TenantContextError,
  currentTenant,
  tenantLogFields,
  withSystemWork,
  withTenant,
  type ClaimedItem,
} from './tenant.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;

beforeAll(async () => {
  database = await createTestDatabase('tenant-wrapper');
  const admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  try {
    await admin.query(
      `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
      [ORG_A, ORG_B],
    );
    await admin.query(
      `insert into locations (organisation_id, id, name) values ($1, gen_random_uuid(), 'Alpha Hamburg'), ($2, gen_random_uuid(), 'Beta Berlin')`,
      [ORG_A, ORG_B],
    );
  } finally {
    await admin.end();
  }
  app = database.pool();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

describe('withTenant', () => {
  it('sets the tenant the policies read', async () => {
    const names = await withTenant(app, ORG_A, async (client) => {
      const result = await client.query<{ name: string }>('select name from locations');
      return result.rows.map((r) => r.name);
    });
    expect(names).toStrictEqual(['Alpha Hamburg']);
  });

  it('scopes each call to its own tenant', async () => {
    const a = await withTenant(
      app,
      ORG_A,
      async (c) => (await c.query<{ name: string }>('select name from locations')).rows[0]?.name,
    );
    const b = await withTenant(
      app,
      ORG_B,
      async (c) => (await c.query<{ name: string }>('select name from locations')).rows[0]?.name,
    );
    expect([a, b]).toStrictEqual(['Alpha Hamburg', 'Beta Berlin']);
  });

  // The failure this module exists to prevent: a setting that survives its transaction and rides
  // the pooled connection into the next request.
  it('leaves nothing behind on the connection it used', async () => {
    await withTenant(app, ORG_A, async (c) => c.query('select 1'));
    const after = await app.query<{ n: number }>('select count(*)::int as n from locations');
    expect(after.rows[0]?.n).toBe(0);
  });

  // P06.10.03: in-database audit writers read the correlation back from the transaction. A uuid
  // correlation_id must survive the round trip; an unset one must read back empty (NULLIF at
  // the read site turns it into NULL), never fail the write.
  it('carries the audit correlation through the transaction', async () => {
    const correlation = '33333333-3333-4333-8333-333333333333';
    const seen = await withTenant(
      app,
      ORG_A,
      async (c) =>
        (
          await c.query<{ v: string }>(
            "select NULLIF(current_setting('app.correlation_id', true), '') as v",
          )
        ).rows[0]?.v,
      { correlationId: correlation },
    );
    expect(seen).toBe(correlation);
    const empty = await withTenant(
      app,
      ORG_A,
      async (c) =>
        (
          await c.query<{ v: string | null }>(
            "select NULLIF(current_setting('app.correlation_id', true), '') as v",
          )
        ).rows[0]?.v,
    );
    expect(empty).toBeNull();
  });

  it('commits on return', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await withTenant(app, ORG_A, async (c) =>
      c.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
        ORG_A,
        id,
        'Alpha Committed',
      ]),
    );
    const found = await withTenant(
      app,
      ORG_A,
      async (c) => (await c.query('select 1 from locations where id = $1', [id])).rows.length,
    );
    expect(found).toBe(1);
  });

  it('rolls back on throw, and the error reaches the caller', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await expect(
      withTenant(app, ORG_A, async (c) => {
        await c.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
          ORG_A,
          id,
          'Alpha Rolled Back',
        ]);
        throw new Error('deliberate');
      }),
    ).rejects.toThrow('deliberate');

    const found = await withTenant(
      app,
      ORG_A,
      async (c) => (await c.query('select 1 from locations where id = $1', [id])).rows.length,
    );
    expect(found).toBe(0);
  });

  it('returns the connection to the pool whether it committed or threw', async () => {
    for (let i = 0; i < 12; i += 1) {
      await withTenant(app, ORG_A, async (c) => c.query('select 1')).catch(() => undefined);
      await withTenant(app, ORG_A, () => {
        throw new Error('x');
      }).catch(() => undefined);
    }
    // A leaked client would have exhausted the pool long before here.
    await expect(withTenant(app, ORG_A, async (c) => c.query('select 1'))).resolves.toBeDefined();
  });

  it('nests the same tenant', async () => {
    const inner = await withTenant(app, ORG_A, async () =>
      withTenant(
        app,
        ORG_A,
        async (c) =>
          (await c.query<{ name: string }>('select name from locations limit 1')).rows[0]?.name,
      ),
    );
    expect(inner).toBe('Alpha Hamburg');
  });

  // Whichever tenant the database ends up applying, something is wrong.
  it('refuses to nest a different tenant', async () => {
    await expect(
      withTenant(app, ORG_A, async () => withTenant(app, ORG_B, async (c) => c.query('select 1'))),
    ).rejects.toThrow(TenantContextError);
  });

  it.each(['', 'not-a-uuid', "'; drop table locations; --", '11111111-1111-4111-8111'])(
    'rejects a malformed organisation id (%j) at the boundary',
    async (value) => {
      await expect(withTenant(app, value, async (c) => c.query('select 1'))).rejects.toThrow(
        TenantContextError,
      );
    },
  );

  it('does not echo the rejected value into the error', async () => {
    await expect(
      withTenant(app, 'secret-looking-value', async (c) => c.query('select 1')),
    ).rejects.toThrow(/not a UUID/u);
    await withTenant(app, ORG_A, async (c) => c.query('select 1'));
    try {
      await withTenant(app, 'secret-looking-value', async (c) => c.query('select 1'));
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-looking-value');
    }
  });
});

describe('the ambient context', () => {
  it('is visible inside the unit of work and absent outside it', async () => {
    expect(currentTenant()).toBeUndefined();
    const inside = await withTenant(app, ORG_A, () => Promise.resolve(currentTenant()), {
      actorId: 'membership-1',
      correlationId: 'corr-1',
    });
    expect(inside).toStrictEqual({
      organisationId: ORG_A,
      actorId: 'membership-1',
      correlationId: 'corr-1',
    });
    expect(currentTenant()).toBeUndefined();
  });

  it('gives the logger fields that are safe to emit, and nothing outside a transaction', async () => {
    expect(tenantLogFields()).toStrictEqual({});
    const fields = await withTenant(app, ORG_A, () => Promise.resolve(tenantLogFields()), {
      correlationId: 'corr-2',
    });
    expect(fields).toStrictEqual({ organisationId: ORG_A, correlationId: 'corr-2' });
  });

  it('inherits actor and correlation through a same-tenant nesting', async () => {
    const inner = await withTenant(
      app,
      ORG_A,
      () => withTenant(app, ORG_A, () => Promise.resolve(currentTenant())),
      { actorId: 'membership-9', correlationId: 'corr-9' },
    );
    expect(inner?.actorId).toBe('membership-9');
    expect(inner?.correlationId).toBe('corr-9');
  });
});

describe('withSystemWork', () => {
  function items(): ClaimedItem[] {
    return [
      { organisationId: ORG_A, id: 'a1' },
      { organisationId: ORG_B, id: 'b1' },
    ];
  }

  it('processes each claimed item inside its own tenant transaction', async () => {
    const seen: { id: string; foreign: number }[] = [];
    const result = await withSystemWork(
      app,
      () => Promise.resolve(items()),
      async (item, client) => {
        // Asserted as the property rather than as a row count: earlier tests in this file insert
        // rows, so an absolute count would couple these tests to their order — which is the class
        // of test that passes in the suite and fails standalone.
        const rows = await client.query<{ n: number }>(
          'select count(*)::int as n from locations where organisation_id <> $1',
          [item.organisationId],
        );
        seen.push({ id: item.id, foreign: rows.rows[0]?.n ?? -1 });
      },
    );
    expect(result).toStrictEqual({ claimed: 2, processed: 2, failed: 0 });
    // Zero foreign rows in each: the sweep never sees two tenants at once, which is the point.
    expect(seen).toStrictEqual([
      { id: 'a1', foreign: 0 },
      { id: 'b1', foreign: 0 },
    ]);
  });

  it('carries the right tenant into each item', async () => {
    const tenants: (string | undefined)[] = [];
    await withSystemWork(
      app,
      () => Promise.resolve(items()),
      () => {
        tenants.push(currentTenant()?.organisationId);
        return Promise.resolve();
      },
    );
    expect(tenants).toStrictEqual([ORG_A, ORG_B]);
  });

  // A sweep that stops at the first bad row leaves the rest of the queue growing behind it.
  it('reports a failing item and keeps going', async () => {
    const failures: string[] = [];
    const result = await withSystemWork(
      app,
      () => Promise.resolve(items()),
      (item) => {
        if (item.id === 'a1') throw new Error('bad row');
        return Promise.resolve();
      },
      (item) => failures.push(item.id),
    );
    expect(result).toStrictEqual({ claimed: 2, processed: 1, failed: 1 });
    expect(failures).toStrictEqual(['a1']);
  });

  it('rejects a claim that returns a malformed organisation id before doing any work', async () => {
    let processed = 0;
    await expect(
      withSystemWork(
        app,
        () => Promise.resolve([{ organisationId: 'not-a-uuid', id: 'x' }]),
        () => {
          processed += 1;
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow(TenantContextError);
    expect(processed).toBe(0);
  });

  // P06.03.03: a job envelope names an organisation, and the handler loads its target *inside*
  // withTenant. If the two disagree — a forged envelope, a stale queue message, a bug — the load
  // returns nothing and the handler does nothing. It is not an error path; it is an empty one,
  // which is what makes a mismatch harmless rather than merely detected.
  it('a job whose envelope names the wrong organisation has no effect', async () => {
    const targetId = '55555555-5555-4555-8555-555555555555';
    await withTenant(app, ORG_A, (c) =>
      c.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
        ORG_A,
        targetId,
        'Alpha Target',
      ]),
    );

    const outcomes: number[] = [];
    // The envelope claims ORG_B; the row belongs to ORG_A.
    const result = await withSystemWork(
      app,
      () => Promise.resolve([{ organisationId: ORG_B, id: targetId }]),
      async (item, client) => {
        const updated = await client.query('update locations set name = $2 where id = $1', [
          item.id,
          'hijacked',
        ]);
        outcomes.push(updated.rowCount ?? -1);
      },
    );

    expect(result).toStrictEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(outcomes).toStrictEqual([0]);

    const name = await withTenant(
      app,
      ORG_A,
      async (c) =>
        (await c.query<{ name: string }>('select name from locations where id = $1', [targetId]))
          .rows[0]?.name,
    );
    expect(name).toBe('Alpha Target');
  });

  it('propagates a failing claim rather than reporting zero work', async () => {
    await expect(
      withSystemWork(
        app,
        () => {
          throw new Error('claim failed');
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('claim failed');
  });
});
