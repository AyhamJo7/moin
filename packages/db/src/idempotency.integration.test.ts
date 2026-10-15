/**
 * Idempotency-Key service (P08.04.01–.03): replay, 422 on body change,
 * concurrent same-key single execution. Synthetic only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { IdempotencyMismatchError, executeIdempotent } from './idempotency.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('idempotency');
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

describe('idempotency', () => {
  evidenceTest('same key + same body replays without re-executing', async () => {
    const key = randomUUID();
    let executions = 0;
    const present = (body: {
      title: string;
    }): Promise<{ result: { n: number }; replayed: boolean }> =>
      withTenant(app, ORG_A, (client) =>
        executeIdempotent(client, {
          operation: 'task.create',
          key,
          body,
          execute: () => {
            executions += 1;
            return Promise.resolve({ n: executions });
          },
        }),
      );
    const first = await present({ title: 'Rückruf' });
    const second = await present({ title: 'Rückruf' });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual({ n: 1 });
    expect(executions).toBe(1);
  });

  evidenceTest('same key + different body is a 422', async () => {
    const key = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      executeIdempotent(client, {
        operation: 'task.create',
        key,
        body: { title: 'A' },
        execute: () => Promise.resolve({ ok: true }),
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        executeIdempotent(client, {
          operation: 'task.create',
          key,
          body: { title: 'B' },
          execute: () => Promise.resolve({ ok: true }),
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyMismatchError);
  });

  evidenceTest('concurrent same key executes once; tenants isolated', async () => {
    const key = randomUUID();
    let executions = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        setTimeout(() => {
          executions += 1;
          resolve(`run-${String(executions)}`);
        }, 50);
      });
    const [left, right] = await Promise.all([
      withTenant(app, ORG_A, (client) =>
        executeIdempotent(client, {
          operation: 'lead.create',
          key,
          body: { name: 'Muster' },
          execute: slow,
        }),
      ),
      withTenant(app, ORG_A, (client) =>
        executeIdempotent(client, {
          operation: 'lead.create',
          key,
          body: { name: 'Muster' },
          execute: slow,
        }),
      ),
    ]);
    // One executes, the other waits on the row lock then replays: the
    // results agree and the effect happened exactly once.
    expect(executions).toBe(1);
    expect(left.result).toBe(right.result);
    // Tenant B keys never collide with tenant A's.
    const foreign = await withTenant(app, ORG_B, (client) =>
      executeIdempotent(client, {
        operation: 'lead.create',
        key,
        body: { name: 'Muster' },
        execute: () => Promise.resolve('foreign'),
      }),
    );
    expect(foreign.replayed).toBe(false);
    expect(foreign.result).toBe('foreign');
  });
});
