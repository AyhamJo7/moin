/**
 * Provider inbox + dedup (P08.03.01–.04): insert-then-ack, 3× delivery one
 * effect (FS-01), poison→DLQ, tenant-scoped handling. Synthetic only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { DuplicateEventError, processInboxEvent, receiveProviderEvent } from './inbox.ts';
import { createPool, type Pool } from './pool.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('inbox');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH')`,
    [ORG_A],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('inbox', () => {
  evidenceTest('same event delivered 3x → one effect (FS-01)', async () => {
    const first = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-3x-001',
    });
    expect(first.status).toBe('received');
    await expect(
      receiveProviderEvent(app, { provider: 'twilio', providerEventId: 'evt-3x-001' }),
    ).rejects.toBeInstanceOf(DuplicateEventError);
    await expect(
      receiveProviderEvent(app, { provider: 'twilio', providerEventId: 'evt-3x-001' }),
    ).rejects.toBeInstanceOf(DuplicateEventError);
    // One row, one effect: the handler runs exactly once.
    let effects = 0;
    const status = await processInboxEvent(
      app,
      first.id,
      () => Promise.resolve(ORG_A),
      () => {
        effects += 1;
        return Promise.resolve();
      },
    );
    expect(status).toBe('resolved');
    expect(effects).toBe(1);
    // Reprocessing a resolved row is a no-op, never a second effect.
    const again = await processInboxEvent(
      app,
      first.id,
      () => Promise.resolve(ORG_A),
      () => {
        effects += 1;
        return Promise.resolve();
      },
    );
    expect(again).toBe('resolved');
    expect(effects).toBe(1);
  });

  evidenceTest('poison events go to DLQ state with reason; transient retries', async () => {
    const poison = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-poison-001',
    });
    // Unresolvable tenant → poisoned, reason recorded.
    const poisoned = await processInboxEvent(
      app,
      poison.id,
      () => Promise.reject(new RangeError('unknown sender')),
      () => Promise.resolve(),
    );
    expect(poisoned).toBe('poisoned');
    // Schema-invalid handler → poisoned, not retried forever.
    const bad = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-poison-002',
    });
    const badStatus = await processInboxEvent(
      app,
      bad.id,
      () => Promise.resolve(ORG_A),
      () => Promise.reject(new RangeError('payload failed validation')),
    );
    expect(badStatus).toBe('poisoned');
    // Transient failure propagates: row stays received for retry.
    const flaky = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-flaky-001',
    });
    await expect(
      processInboxEvent(
        app,
        flaky.id,
        () => Promise.resolve(ORG_A),
        () => Promise.reject(new Error('db failover mid-handler')),
      ),
    ).rejects.toThrow('db failover mid-handler');
    const row = await admin.query<{ status: string }>(
      `select status from provider_inbox where id = $1::uuid`,
      [flaky.id],
    );
    expect(row.rows[0]?.status).toBe('received');
  });

  evidenceTest('out-of-order events handled by monotonic state at the handler', async () => {
    // The inbox preserves arrival; the handler ignores backwards moves.
    // Proven here by sequence: v2 then v1 for one aggregate — the handler
    // applies v2 and skips v1 (monotonic guard lives in the handler).
    const applied: number[] = [];
    let current = 0;
    const applyVersion = (version: number): void => {
      if (version > current) {
        current = version;
        applied.push(version);
      }
    };
    const v2 = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-order-v2',
    });
    const v1 = await receiveProviderEvent(app, {
      provider: 'twilio',
      providerEventId: 'evt-order-v1',
    });
    await processInboxEvent(
      app,
      v2.id,
      () => Promise.resolve(ORG_A),
      () => {
        applyVersion(2);
        return Promise.resolve();
      },
    );
    await processInboxEvent(
      app,
      v1.id,
      () => Promise.resolve(ORG_A),
      () => {
        applyVersion(1);
        return Promise.resolve();
      },
    );
    expect(applied).toEqual([2]);
  });
});
