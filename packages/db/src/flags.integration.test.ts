/**
 * Flags + kill switches (P08.10.01–.04): defaults, overrides, audit, the
 * ai_answering kill → deterministic capture. Synthetic only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { isAiAnsweringEnabled, isEnabled, setFlag } from './flags.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('flags');
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

describe('flags', () => {
  evidenceTest('defaults apply; overrides win per tenant; unknown flags throw', async () => {
    expect(await withTenant(app, ORG_A, (client) => isEnabled(client, 'ai_answering'))).toBe(true);
    await withTenant(app, ORG_A, (client) => setFlag(client, 'ai_answering', false));
    expect(await withTenant(app, ORG_A, (client) => isEnabled(client, 'ai_answering'))).toBe(false);
    // Tenant B keeps the default — overrides never leak.
    expect(await withTenant(app, ORG_B, (client) => isEnabled(client, 'ai_answering'))).toBe(true);
    // Clearing restores the default.
    expect(await withTenant(app, ORG_A, (client) => setFlag(client, 'ai_answering', null))).toBe(
      true,
    );
    expect(await withTenant(app, ORG_A, (client) => isEnabled(client, 'ai_answering'))).toBe(true);
    await expect(withTenant(app, ORG_A, (client) => isEnabled(client, 'nope'))).rejects.toThrow(
      RangeError,
    );
    await expect(
      withTenant(app, ORG_A, (client) => setFlag(client, 'nope', true)),
    ).rejects.toThrow(RangeError);
  });

  evidenceTest('ai_answering off means deterministic capture only', async () => {
    // The voice runtime branches on this accessor before any model call:
    // off → capture path, on → answer path. Proven here at the accessor.
    await withTenant(app, ORG_A, (client) => setFlag(client, 'ai_answering', false));
    const mode = (await withTenant(app, ORG_A, (client) => isAiAnsweringEnabled(client)))
      ? 'answer'
      : 'capture';
    expect(mode).toBe('capture');
    await withTenant(app, ORG_A, (client) => setFlag(client, 'ai_answering', true));
    const back = (await withTenant(app, ORG_A, (client) => isAiAnsweringEnabled(client)))
      ? 'answer'
      : 'capture';
    expect(back).toBe('answer');
  });

  evidenceTest('flag changes are audited with markers only', async () => {
    await withTenant(app, ORG_A, (client) => setFlag(client, 'sms', false));
    const events = await withTenant(app, ORG_A, (client) =>
      listAuditEvents(client, { targetKind: 'feature_flag' }),
    );
    expect(events.length).toBeGreaterThan(0);
    // Markers only: no flag name or reason text in the trail (INV-12).
    for (const event of events) {
      expect(JSON.stringify(event.args_sanitized)).not.toContain('sms');
    }
    // Tenant B audit shows nothing of A's flips.
    const foreign = await withTenant(app, ORG_B, (client) =>
      listAuditEvents(client, { targetKind: 'feature_flag' }),
    );
    expect(foreign).toEqual([]);
  });
});
