import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

let database: TestDatabase;
let admin: Pool;

async function tenantOrg(): Promise<string> {
  const id = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1::uuid, $2, $3)', [
    id,
    `oi-${id.slice(0, 8)}`,
    'owner-invariant-test',
  ]);
  return id;
}

async function person(status = 'active'): Promise<string> {
  const id = randomUUID();
  await admin.query(
    'insert into users (id, cognito_sub, email, status) values ($1::uuid, $2, $3, $4)',
    [id, randomUUID(), `${id.slice(0, 8)}@example.test`, status],
  );
  return id;
}

async function member(
  forOrg: string,
  userId: string,
  role = 'owner',
  status = 'active',
): Promise<void> {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1::uuid, $2::uuid, $3::uuid, $4, $5)',
    [forOrg, randomUUID(), userId, role, status],
  );
}

beforeAll(async () => {
  database = await createTestDatabase('owner-invariant');
  admin = createPool({ connectionString: database.migrationUrl, max: 4 });
}, 60_000);

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('effective-owner invariant (0029)', () => {
  evidenceTest('H1: disabling the last active owner user fails', async () => {
    const forOrg = await tenantOrg();
    const owner = await person();
    await member(forOrg, owner);
    await expect(
      admin.query('update users set status = $1 where id = $2::uuid', ['disabled', owner]),
    ).rejects.toThrow(/at least one active owner/);
  });

  evidenceTest('H1: active second owner absorbs the disable', async () => {
    const forOrg = await tenantOrg();
    const owner = await person();
    const keeper = await person();
    await member(forOrg, owner);
    await member(forOrg, keeper);
    await admin.query('update users set status = $1 where id = $2::uuid', ['disabled', owner]);
    const left = await admin.query<{ n: string }>(
      `select count(*)::text as n from memberships m join users u on u.id = m.user_id
       where m.organisation_id = $1::uuid and m.role = 'owner' and m.status = 'active'
       and u.status = 'active'`,
      [forOrg],
    );
    expect(left.rows[0]?.n).toBe('1');
  });

  evidenceTest('H3: deleting the organisation cascades clean', async () => {
    const forOrg = await tenantOrg();
    const owner = await person();
    await member(forOrg, owner);
    await admin.query('delete from organisations where id = $1::uuid', [forOrg]);
    const left = await admin.query<{ n: string }>(
      'select count(*)::text as n from memberships where organisation_id = $1::uuid',
      [forOrg],
    );
    expect(left.rows[0]?.n).toBe('0');
  });

  evidenceTest('directly deleting the last owner membership still fails', async () => {
    const forOrg = await tenantOrg();
    const owner = await person();
    await member(forOrg, owner);
    await expect(
      admin.query('delete from memberships where user_id = $1::uuid', [owner]),
    ).rejects.toThrow(/at least one active owner/);
  });
});
