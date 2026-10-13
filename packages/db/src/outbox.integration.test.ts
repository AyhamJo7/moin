/**
 * Transactional outbox + dispatcher (P08.02.01–.04): insert in-txn, SKIP LOCKED
 * dispatch, backoff retry, crash-tolerant republish, per-aggregate versions,
 * tenant isolation. Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
  dispatchOutboxBatch,
  insertOutboxEvent,
  outboxLagSeconds,
  type OutboxEvent,
} from './outbox.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('outbox');
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

async function insert(
  org: string,
  over: { aggregateVersion?: number; payload?: Record<string, string> } = {},
): Promise<string> {
  return withTenant(app, org, (client) =>
    insertOutboxEvent(client, {
      aggregate: 'tasks',
      aggregateId: randomUUID(),
      aggregateVersion: over.aggregateVersion ?? 1,
      eventType: 'task.created',
      payload: over.payload ?? { taskId: randomUUID() },
    }),
  );
}

describe('outbox', () => {
  evidenceTest('insert validates; dispatch publishes once and marks', async () => {
    await insert(ORG_A);
    await expect(
      withTenant(app, ORG_A, (client) =>
        insertOutboxEvent(client, {
          aggregate: 'tasks',
          aggregateId: 'nope',
          aggregateVersion: 1,
          eventType: 'task.created',
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        insertOutboxEvent(client, {
          aggregate: 'tasks',
          aggregateId: randomUUID(),
          aggregateVersion: 1,
          eventType: 'task.created',
          payload: { note: 'content, not an id' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    const seen: OutboxEvent[] = [];
    const result = await withTenant(app, ORG_A, (client) =>
      dispatchOutboxBatch(client, (event) => {
        seen.push(event);
        return Promise.resolve();
      }),
    );
    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(seen[0]?.aggregateVersion).toBe(1);
    // Drained: lag null, second dispatch publishes nothing.
    expect(await withTenant(app, ORG_A, (client) => outboxLagSeconds(client))).toBeNull();
    const again = await withTenant(app, ORG_A, (client) =>
      dispatchOutboxBatch(client, () => Promise.resolve()),
    );
    expect(again.published).toBe(0);
  });

  evidenceTest('crash between publish and mark republishes; versions order per aggregate', async () => {
    const agg = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      insertOutboxEvent(client, {
        aggregate: 'tasks',
        aggregateId: agg,
        aggregateVersion: 2,
        eventType: 'task.updated',
      }),
    );
    // Publish fails after the side effect (crash before mark): the row stays
    // undispatched with attempts bumped and next_attempt_at set (backoff).
    let crashed = false;
    await withTenant(app, ORG_A, (client) =>
      dispatchOutboxBatch(client, (event) => {
        if (event.aggregateId === agg) {
          crashed = true;
          throw new Error('crash after side effect');
        }
        return Promise.resolve();
      }),
    );
    expect(crashed).toBe(true);
    const failed = await withTenant(app, ORG_A, (client) =>
      client.query<{ attempts: number; has_backoff: boolean }>(
        `select attempts, (next_attempt_at is not null) as has_backoff from outbox
         where aggregate_id = $1::uuid and dispatched_at is null`,
        [agg],
      ),
    );
    expect(failed.rows[0]?.['attempts']).toBe(1);
    expect(failed.rows[0]?.['has_backoff']).toBe(true);
    // Backoff elapsed (test fast-forwards): republish recurs with the same
    // aggregate version — the idempotent consumer dedups on it.
    await withTenant(app, ORG_A, (client) =>
      client.query(`update outbox set next_attempt_at = now() where aggregate_id = $1::uuid`, [agg]),
    );
    const redelivered: OutboxEvent[] = [];
    await withTenant(app, ORG_A, (client) =>
      dispatchOutboxBatch(client, (event) => {
        if (event.aggregateId === agg) redelivered.push(event);
        return Promise.resolve();
      }),
    );
    expect(redelivered).toHaveLength(1);
    expect(redelivered[0]?.aggregateVersion).toBe(2);
  });

  evidenceTest('lag reports when backlog exists; tenants isolated', async () => {
    await insert(ORG_A);
    const lag = await withTenant(app, ORG_A, (client) => outboxLagSeconds(client));
    expect(typeof lag).toBe('number');
    // Tenant B dispatch never touches tenant A's rows: the dispatcher
    // boundary is the WHERE clause on app.current_org(), not RLS (the
    // table is global by dispatcher design, ADR-0007).
    const foreign = await withTenant(app, ORG_B, (client) =>
      dispatchOutboxBatch(client, () => Promise.resolve()),
    );
    expect(foreign.published).toBe(0);
  });
});
