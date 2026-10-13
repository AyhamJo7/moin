/**
 * Timers + sweeps (P08.07.01–.04): idempotent schedule, SKIP LOCKED leases,
 * exactly-once under 3 concurrent sweepers, restart survival. INV-16.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';
import { claimDueTimers, completeTimer, scheduleTimer } from './timers.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('timers');
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

function past(): Date {
  return new Date(Date.now() - 60_000);
}

describe('timers', () => {
  evidenceTest('schedule is idempotent per kind+ref; earlier due wins', async () => {
    const ref = randomUUID();
    const first = await withTenant(app, ORG_A, (client) =>
      scheduleTimer(client, { kind: 'task-reminder', refId: ref, dueAt: past() }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      scheduleTimer(client, {
        kind: 'task-reminder',
        refId: ref,
        dueAt: new Date(Date.now() + 3_600_000),
      }),
    );
    expect(second).toBe(first);
  });

  evidenceTest('exactly-once effect under 3 concurrent sweepers', async () => {
    const ref = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      scheduleTimer(client, { kind: 'escalation-ack', refId: ref, dueAt: past() }),
    );
    // Three sweepers claim concurrently — disjoint sets by SKIP LOCKED.
    const [a, b, c] = await Promise.all([
      withTenant(app, ORG_A, (client) => claimDueTimers(client)),
      withTenant(app, ORG_A, (client) => claimDueTimers(client)),
      withTenant(app, ORG_A, (client) => claimDueTimers(client)),
    ]);
    const claimed = [...a, ...b, ...c].filter((t) => t.refId === ref);
    expect(claimed).toHaveLength(1);
    // The winner completes; the effect ran once. Re-claim finds nothing.
    expect(
      await withTenant(app, ORG_A, (client) => completeTimer(client, claimed[0]?.id ?? '')),
    ).toBe(true);
    const reclaimed = await withTenant(app, ORG_A, (client) => claimDueTimers(client));
    expect(reclaimed.filter((t) => t.refId === ref)).toHaveLength(0);
    // Tenant B never claims tenant A's timers.
    const foreign = await withTenant(app, ORG_B, (client) => claimDueTimers(client));
    expect(foreign.filter((t) => t.refId === ref)).toHaveLength(0);
  });

  evidenceTest('timers survive restarts: expired leases re-claim, done never refires', async () => {
    const ref = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      scheduleTimer(client, { kind: 'summary-expiry', refId: ref, dueAt: past() }),
    );
    const [lease] = await withTenant(app, ORG_A, (client) => claimDueTimers(client, 1));
    expect(lease?.refId).toBeDefined();
    // Crash before complete (restart): lease expires → re-claimable.
    await withTenant(app, ORG_A, (client) =>
      client.query(`update timers set lease_until = now() - interval '1 second' where id = $1::uuid`, [
        lease?.id ?? '',
      ]),
    );
    const reclaimed = await withTenant(app, ORG_A, (client) => claimDueTimers(client, 10));
    expect(reclaimed.map((t) => t.id)).toContain(lease?.id);
    expect(
      await withTenant(app, ORG_A, (client) => completeTimer(client, lease?.id ?? '')),
    ).toBe(true);
    // Done rows never refire, even past due.
    const after = await withTenant(app, ORG_A, (client) => claimDueTimers(client, 10));
    expect(after.map((t) => t.id)).not.toContain(lease?.id);
  });
});
