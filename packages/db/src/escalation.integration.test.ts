/**
 * Escalation rows (P14.05.04): exactly-once per step, ack stops the chain,
 * per-tenant isolation. Synthetic (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { recordAck, scheduleLevel } from './escalation.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('escalation');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('escalation', () => {
  evidenceTest('repeats keep one row per step (exactly-once)', async () => {
    const refId = randomUUID();
    const first = await withTenant(app, ORG_A, (client) =>
      scheduleLevel(client, {
        refKind: 'task',
        refId,
        level: 0,
        contactUserId: CONTACT,
        dueAt: new Date('2026-10-14T20:00:00Z'),
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      scheduleLevel(client, {
        refKind: 'task',
        refId,
        level: 0,
        contactUserId: CONTACT,
        dueAt: new Date('2026-10-14T20:10:00Z'),
      }),
    );
    expect(second).toBe(first);
  });

  evidenceTest('first ack wins; tenants isolated', async () => {
    const refId = randomUUID();
    const first = await withTenant(app, ORG_A, (client) =>
      recordAck(client, { refKind: 'task', refId, state: 'acknowledged' }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      recordAck(client, { refKind: 'task', refId, state: 'done' }),
    );
    expect(second).toBe(first);
    const other = await withTenant(app, ORG_B, (client) =>
      recordAck(client, { refKind: 'task', refId, state: 'acknowledged' }),
    );
    expect(other).not.toBe(first);
  });
});
