import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

let database: TestDatabase;
let admin: Pool;

let org: string;
let actor: string;

async function tenantOrg(): Promise<string> {
  const id = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1::uuid, $2, $3)', [
    id,
    `gg-${id.slice(0, 8)}`,
    'grant-gate-test',
  ]);
  return id;
}

async function seedGrant(forOrg: string, operator: string, hoursFromNow: number, createdAgoH: number) {
  const id = randomUUID();
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.organisation_id', forOrg]);
    await client.query(
      `insert into support_access_grants
         (organisation_id, id, operator_subject, scope, reason, created_by, created_at, expires_at)
       values ($1::uuid, $2::uuid, $3, 'readonly', $4, $5::uuid,
         now() - make_interval(hours => $6), now() + make_interval(hours => $7))`,
      [forOrg, id, operator, 'seeded grant reason', actor, createdAgoH, hoursFromNow],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return id;
}

async function gate(forOrg: string, operator: string): Promise<string | null> {
  const r = await admin.query<{ live_support_grant: string | null }>(
    'select app.live_support_grant($1::uuid, $2, $3) as live_support_grant',
    [forOrg, operator, 'readonly'],
  );
  return r.rows[0]?.live_support_grant ?? null;
}

async function createGrant(forOrg: string, operator: string, reason = 'grant reason here'): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.organisation_id', forOrg]);
    const r = await client.query<{ create_support_grant: string }>(
      'select app.create_support_grant($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid) as create_support_grant',
      [forOrg, operator, 'readonly', reason, 24, actor, randomUUID()],
    );
    await client.query('commit');
    const id = r.rows[0]?.create_support_grant;
    if (id === undefined) throw new Error('grant creation returned no id');
    return id;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  database = await createTestDatabase('support-grant-gate');
  admin = createPool({ connectionString: database.migrationUrl, max: 4 });
  org = await tenantOrg();
  actor = randomUUID();
  await admin.query(
    'insert into users (id, cognito_sub, email, status) values ($1::uuid, $2, $3, $4)',
    [actor, randomUUID(), `${randomUUID().slice(0, 8)}@example.test`, 'active'],
  );
}, 60_000);

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('support grant gate hardening (0028)', () => {
  evidenceTest('H1: live grant wins over expired shadow', async () => {
    const operator = `op-h1-${randomUUID().slice(0, 8)}`;
    await seedGrant(org, operator, -1, 48);
    const live = await seedGrant(org, operator, 24, 1);
    expect(await gate(org, operator)).toBe(live);
  });

  evidenceTest('H1b: create supersedes prior live grants', async () => {
    const operator = `op-h1b-${randomUUID().slice(0, 8)}`;
    await createGrant(org, operator, 'first grant reason');
    const second = await createGrant(org, operator, 'second grant reason');
    expect(await gate(org, operator)).toBe(second);
  });

  evidenceTest('H2: emergency reference must bind the operator', async () => {
    const operator = `op-h2-${randomUUID().slice(0, 8)}`;
    await expect(
      admin.query(
        'select app.support_emergency_read_memberships($1::uuid, $2, $3::uuid, $4::uuid, $5)',
        [org, operator, actor, randomUUID(), 'test'],
      ),
    ).rejects.toThrow(/bound to the operator/);
    await expect(
      admin.query(
        'select app.support_emergency_read_memberships($1::uuid, $2, $3::uuid, $4::uuid, $5)',
        [org, operator, actor, randomUUID(), `op:someone-else:ticket-1234`],
      ),
    ).rejects.toThrow(/bound to the operator/);
    const bound = await admin.query(
      'select app.support_emergency_read_memberships($1::uuid, $2, $3::uuid, $4::uuid, $5)',
      [org, operator, actor, randomUUID(), `op:${operator}:ticket-1234`],
    );
    expect(bound.command).toBe('SELECT');
    const priv = await admin.query<{ has_function_privilege: boolean }>(
      `select has_function_privilege('moin_app',
        'app.support_emergency_read_memberships(uuid, text, uuid, uuid, text)', 'EXECUTE')
        as has_function_privilege`,
    );
    expect(priv.rows[0]?.has_function_privilege).toBe(false);
  });

  evidenceTest('M1: 6th concurrent live grant refuses', async () => {
    const org2 = await tenantOrg();
    for (let i = 0; i < 5; i++) {
      await createGrant(org2, `cap-op-${i}`, `grant reason number ${i}`);
    }
    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', org2]);
      await expect(
        client.query(
          'select app.create_support_grant($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid)',
          [org2, 'cap-op-5', 'readonly', 'grant reason number 5', 24, actor, randomUUID()],
        ),
      ).rejects.toThrow(/grant quota exceeded/);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  evidenceTest('M2: gate takes FOR SHARE and concurrent reads proceed', async () => {
    const operator = `op-m2-${randomUUID().slice(0, 8)}`;
    await seedGrant(org, operator, 24, 1);
    const holder = createPool({ connectionString: database.migrationUrl, max: 1 });
    try {
      await holder.query('begin');
      await holder.query('select app.live_support_grant($1::uuid, $2, $3)', [
        org,
        operator,
        'readonly',
      ]);
      const holderLocks = await holder.query<{ locktype: string; mode: string }>(
        `select locktype, mode from pg_locks where pid = pg_backend_pid()
         and locktype = 'tuple'`,
        [],
      );
      const modes = holderLocks.rows.map((r) => r.mode);
      expect(modes).toContain('ShareLock');
      expect(modes).not.toContain('ExclusiveLock');
      const second = await gate(org, operator);
      expect(second).not.toBeNull();
      await holder.query('commit');
    } finally {
      await holder.end();
    }
  });
});
