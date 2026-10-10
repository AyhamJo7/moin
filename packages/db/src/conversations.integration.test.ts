/**
 * Conversations, calls and outcomes (P07.05.04): idempotent ingest, monotonic status,
 * validated outcomes, tenant isolation.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  advanceCallStatus,
  getOutcome,
  ingestCall,
  recordCallEvent,
  recordOutcome,
  startConversation,
} from './conversations.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('conversations');
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

describe('conversations', () => {
  evidenceTest('duplicate ingest by provider SID returns the same row', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-dup-1', fromNumber: '+4930123456' }),
    );
    expect(first.created).toBe(true);
    expect(first.call.status).toBe('initiated');
    const second = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-dup-1', fromNumber: '+4999999999' }),
    );
    expect(second.created).toBe(false);
    expect(second.call.id).toBe(first.call.id);
    // The retry did not rewrite the stored caller: first write wins.
    const stored = await withTenant(app, ORG_A, (client) =>
      client.query<{ from_number: string | null }>(`select from_number from calls where id = $1`, [
        first.call.id,
      ]),
    );
    expect(stored.rows[0]?.from_number).toBe('+4930123456');
  });

  evidenceTest('status climbs the ladder and never goes back', async () => {
    const { call } = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-ladder-1' }),
    );
    const rung2 = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'ringing'),
    );
    expect(rung2.moved).toBe(true);
    expect(rung2.call.status).toBe('ringing');
    const rung3 = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'in_progress'),
    );
    expect(rung3.moved).toBe(true);
    // Out-of-order: ringing after in_progress is kept as an event but moves nothing.
    const back = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'ringing'),
    );
    expect(back.moved).toBe(false);
    expect(back.call.status).toBe('in_progress');
    // Same rung twice: no move.
    const same = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'in_progress'),
    );
    expect(same.moved).toBe(false);
    // Terminal from any rung applies.
    const done = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'completed'),
    );
    expect(done.moved).toBe(true);
    const events = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from call_events where call_id = $1 and kind = 'status_change'`,
        [call.id],
      ),
    );
    // ingest(1) + ringing + in_progress + rejected-ringing + rejected-same + completed = 6.
    expect(events.rows[0]?.n).toBe('6');
  });

  evidenceTest('outcome writer accepts the closed set and rejects unvalidated facts', async () => {
    const conversation = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    const outcome = await withTenant(app, ORG_A, (client) =>
      recordOutcome(client, conversation.id, {
        resultCode: 'callback_requested',
        handledAutomatically: false,
      }),
    );
    expect(outcome.resultCode).toBe('callback_requested');
    expect(
      await withTenant(app, ORG_A, (client) => getOutcome(client, conversation.id)),
    ).toMatchObject({ resultCode: 'callback_requested', handledAutomatically: false });
    // Facts without a schema version are refused.
    await expect(
      withTenant(app, ORG_A, (client) =>
        recordOutcome(client, conversation.id, {
          resultCode: 'handled',
          facts: { name: 'Gast' },
          handledAutomatically: true,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Second outcome for the same conversation collides (one verdict each).
    await expect(
      withTenant(app, ORG_A, (client) =>
        recordOutcome(client, conversation.id, {
          resultCode: 'handled',
          handledAutomatically: true,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  evidenceTest('cross-tenant conversation rows are invisible', async () => {
    const ingested = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-private-1' }),
    );
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from calls where provider_call_sid = 'CA-private-1'`,
      ),
    );
    expect(foreign.rows[0]?.n).toBe('0');
    const own = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from calls where provider_call_sid = 'CA-private-1'`,
      ),
    );
    expect(own.rows[0]?.n).toBe('1');
    expect(ingested.call.id).toBeDefined();
  });

  evidenceTest('mutations audit with opaque markers, no wire text', async () => {
    const { call } = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-audit-1', fromNumber: '+4930654321' }),
    );
    await withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'ringing'));
    await withTenant(app, ORG_A, (client) => recordCallEvent(client, call.id, 'routing', 3));
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: call.id });
      expect(events.map((e) => e.operation)).toContain('call.status');
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('4930654321');
      }
    });
  });

  it('records arbitrary call events with opaque detail markers', async () => {
    const { call } = await withTenant(app, ORG_B, (client) =>
      ingestCall(client, { providerCallSid: 'CA-event-1' }),
    );
    await withTenant(app, ORG_B, (client) => recordCallEvent(client, call.id, 'failure', 7));
    await expect(
      withTenant(app, ORG_B, (client) => recordCallEvent(client, call.id, 'failure', 1.5)),
    ).rejects.toBeInstanceOf(RangeError);
    const count = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from call_events where call_id = $1`,
        [call.id],
      ),
    );
    // ingest status_change + one failure; the fractional detail never wrote.
    expect(count.rows[0]?.n).toBe('2');
  });
});
