/**
 * Booking core (P20 SELL): hold-confirm + genuine two-caller refusal.
 * Synthetic (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { confirmHold, HoldRefused, holdSlot } from './booking.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('booking');
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

function slot() {
  const start = new Date(Date.now() + 3_600_000);
  return { start, end: new Date(start.getTime() + 1_800_000) };
}

describe('booking', () => {
  evidenceTest('hold then confirm succeeds; confirm retry reuses the marker', async () => {
    const { start, end } = slot();
    const resourceId = randomUUID();
    const holdId = await withTenant(app, ORG_A, (client) =>
      holdSlot(client, {
        resourceId,
        startsAt: start,
        endsAt: end,
        idempotencyKey: `h:${resourceId}`,
      }),
    );
    const key = `c:${resourceId}`;
    const ok = await withTenant(app, ORG_A, (client) =>
      confirmHold(client, { holdId, idempotencyKey: key }),
    );
    expect(ok).toBe(true);
    const again = await withTenant(app, ORG_A, (client) =>
      confirmHold(client, { holdId, idempotencyKey: key }),
    );
    expect(again).toBe(true);
  });

  evidenceTest('two callers same slot: second key refused (HoldRefused)', async () => {
    const { start, end } = slot();
    const resourceId = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      holdSlot(client, {
        resourceId,
        startsAt: start,
        endsAt: end,
        idempotencyKey: `caller-a:${resourceId}`,
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        holdSlot(client, {
          resourceId,
          startsAt: start,
          endsAt: end,
          idempotencyKey: `caller-b:${resourceId}`,
        }),
      ),
    ).rejects.toThrow(HoldRefused);
  });

  evidenceTest('same-key retry reuses the hold; tenants isolated', async () => {
    const { start, end } = slot();
    const resourceId = randomUUID();
    const key = `dbl:${resourceId}`;
    const first = await withTenant(app, ORG_A, (client) =>
      holdSlot(client, { resourceId, startsAt: start, endsAt: end, idempotencyKey: key }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      holdSlot(client, { resourceId, startsAt: start, endsAt: end, idempotencyKey: key }),
    );
    expect(second).toBe(first);
    const other = await withTenant(app, ORG_B, (client) =>
      holdSlot(client, { resourceId, startsAt: start, endsAt: end, idempotencyKey: key }),
    );
    expect(other).not.toBe(first);
  });
});
