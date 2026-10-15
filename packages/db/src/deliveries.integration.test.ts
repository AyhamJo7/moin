/**
 * Delivery receipts (P14.07.03): recorded per attempt, redelivery deduped,
 * tenants isolated. Synthetic (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { recordDelivery } from './deliveries.ts';
import { triggerNotification } from './notifications.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('deliveries');
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

describe('deliveries', () => {
  evidenceTest('records receipts; redelivery reuses the idempotency key', async () => {
    const refId = randomUUID();
    const notificationId = await withTenant(app, ORG_A, (client) =>
      triggerNotification(client, {
        dedupKey: `task:${refId}:urgent`,
        priority: 'urgent',
        refKind: 'task',
        refId,
      }),
    );
    const key = `dlv:${notificationId}:email:0`;
    const first = await withTenant(app, ORG_A, (client) =>
      recordDelivery(client, {
        notificationId,
        channel: 'email',
        attempt: 0,
        status: 'failed',
        idempotencyKey: key,
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      recordDelivery(client, {
        notificationId,
        channel: 'email',
        attempt: 0,
        status: 'failed',
        idempotencyKey: key,
      }),
    );
    expect(second).toBe(first);
  });

  evidenceTest('isolates delivery keys per tenant', async () => {
    const refId = randomUUID();
    const key = `dlv:${refId}:sms:0`;
    const nidA = await withTenant(app, ORG_A, (client) =>
      triggerNotification(client, {
        dedupKey: `a:${refId}`,
        priority: 'urgent',
        refKind: 'task',
        refId,
      }),
    );
    const nidB = await withTenant(app, ORG_B, (client) =>
      triggerNotification(client, {
        dedupKey: `b:${refId}`,
        priority: 'urgent',
        refKind: 'task',
        refId,
      }),
    );
    const a = await withTenant(app, ORG_A, (client) =>
      recordDelivery(client, {
        notificationId: nidA,
        channel: 'sms',
        attempt: 0,
        status: 'pending',
        idempotencyKey: key,
      }),
    );
    const b = await withTenant(app, ORG_B, (client) =>
      recordDelivery(client, {
        notificationId: nidB,
        channel: 'sms',
        attempt: 0,
        status: 'pending',
        idempotencyKey: key,
      }),
    );
    expect(b).not.toBe(a);
  });
});
