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

  evidenceTest('concurrent ingest by provider SID converges on one row', async () => {
    const callsBefore = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from calls`),
    );
    const convosBefore = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from conversations`),
    );
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) =>
        ingestCall(client, { providerCallSid: 'CA-race-1', fromNumber: '+4930111111' }),
      ),
      withTenant(app, ORG_A, (client) =>
        ingestCall(client, { providerCallSid: 'CA-race-1', fromNumber: '+4930222222' }),
      ),
    ]);
    expect(one.call.id).toBe(two.call.id);
    expect([one.created, two.created].sort()).toStrictEqual([false, true]);
    const callsAfter = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from calls`),
    );
    expect(Number(callsAfter.rows[0]?.n) - Number(callsBefore.rows[0]?.n)).toBe(1);
    // No orphan conversations: the advisory lock serialises same-SID ingests, so the loser
    // never writes (a data-modifying CTE would have left one behind per retry).
    const convosAfter = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from conversations`),
    );
    expect(Number(convosAfter.rows[0]?.n) - Number(convosBefore.rows[0]?.n)).toBe(1);
    expect([one, two].filter((r) => r.created).length).toBe(1);
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
    // Terminal from a live rung applies; terminal-to-terminal never moves.
    const done = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'completed'),
    );
    expect(done.moved).toBe(true);
    const terminalAgain = await withTenant(app, ORG_A, (client) =>
      advanceCallStatus(client, call.id, 'failed'),
    );
    expect(terminalAgain.moved).toBe(false);
    expect(terminalAgain.call.status).toBe('completed');
    const events = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from call_events where call_id = $1 and kind = 'status_change'`,
        [call.id],
      ),
    );
    // ingest + ringing + in_progress + rejected-ringing + rejected-same + completed + rejected-terminal = 7.
    expect(events.rows[0]?.n).toBe('7');
  });

  evidenceTest('concurrent advances serialise: exactly one moves', async () => {
    const { call } = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-race-status-1' }),
    );
    await withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'ringing'));
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'in_progress')),
      withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'in_progress')),
    ]);
    expect([one.moved, two.moved].sort()).toStrictEqual([false, true]);
    const kept = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string }>(`select status from calls where id = $1`, [call.id]),
    );
    expect(kept.rows[0]?.status).toBe('in_progress');
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
    // Facts without a schema version are refused; any other version is refused too
    // (no validator exists until P07.09).
    await expect(
      withTenant(app, ORG_A, (client) =>
        recordOutcome(client, conversation.id, {
          resultCode: 'handled',
          facts: { name: 'Gast' },
          handledAutomatically: true,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        recordOutcome(client, conversation.id, {
          resultCode: 'handled',
          factsSchemaVersion: 'v9-custom',
          facts: { name: 'Gast' },
          handledAutomatically: true,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // The DB CHECK mirrors the service: a hand-written non-v0 row is rejected (23514).
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into interaction_outcomes
             (organisation_id, id, conversation_id, result_code, facts_schema_version, facts, handled_automatically)
           values (app.current_org(), gen_random_uuid(), $1, 'handled', 'v9-custom', '{"a":1}', false)`,
          [conversation.id],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
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

  evidenceTest('call_events is append-only: moin_app cannot UPDATE or DELETE', async () => {
    const { call } = await withTenant(app, ORG_B, (client) =>
      ingestCall(client, { providerCallSid: 'CA-readonly-1' }),
    );
    await expect(
      withTenant(app, ORG_B, (client) =>
        client.query(`update call_events set detail = 99 where call_id = $1`, [call.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(app, ORG_B, (client) =>
        client.query(`delete from call_events where call_id = $1`, [call.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  evidenceTest('racing terminal against forward lands the terminal', async () => {
    const { call } = await withTenant(app, ORG_A, (client) =>
      ingestCall(client, { providerCallSid: 'CA-race-terminal-1' }),
    );
    await withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'ringing'));
    const [forward, terminal] = await Promise.all([
      withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'in_progress')),
      withTenant(app, ORG_A, (client) => advanceCallStatus(client, call.id, 'completed')),
    ]);
    // Whichever order the updates landed, the terminal wins: completed is reachable from ringing
    // and from in_progress, and in_progress never overwrites completed (guarded UPDATE).
    const kept = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string }>(`select status from calls where id = $1`, [call.id]),
    );
    expect(kept.rows[0]?.status).toBe('completed');
    expect([forward.moved, terminal.moved].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const events = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from call_events where call_id = $1 and kind = 'status_change'`,
        [call.id],
      ),
    );
    // ingest + ringing + both racers' events = 4.
    expect(events.rows[0]?.n).toBe('4');
  });

  evidenceTest('deleting a contact with history is refused; erasure clears first', async () => {
    const contact = await withTenant(app, ORG_B, async (client) => {
      const { createContact } = await import('./contacts.ts');
      return createContact(client, { displayName: 'Transient' });
    });
    const conversation = await withTenant(app, ORG_B, (client) =>
      startConversation(client, { channel: 'call', contactId: contact.id }),
    );
    expect(conversation.contactId).toBe(contact.id);
    // Composite RESTRICT: history blocks the delete (23503), so nothing is silently re-homed.
    await expect(
      admin.query(`delete from contacts where id = $1`, [contact.id]),
    ).rejects.toMatchObject({ code: '23503' });
    // Erasure path: clear the link first, then the delete succeeds and history survives.
    await withTenant(app, ORG_B, (client) =>
      client.query(`update conversations set contact_id = null where id = $1`, [conversation.id]),
    );
    await admin.query(`delete from contacts where id = $1`, [contact.id]);
    const left = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string; contact: string | null }>(
        `select count(*)::text as n, max(contact_id::text) as contact
         from conversations where id = $1`,
        [conversation.id],
      ),
    );
    expect(left.rows[0]).toMatchObject({ n: '1', contact: null });
  });

  evidenceTest('moin_app cannot DELETE conversations or calls; events survive', async () => {
    const { call } = await withTenant(app, ORG_B, (client) =>
      ingestCall(client, { providerCallSid: 'CA-nodelete-1' }),
    );
    const eventsBefore = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from call_events`),
    );
    // DELETE on either parent is refused (42501) — a parent delete would cascade into
    // call_events past its SELECT,INSERT-only grant.
    await expect(
      withTenant(app, ORG_B, (client) =>
        client.query(`delete from calls where id = $1`, [call.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(app, ORG_B, (client) =>
        client.query(`delete from conversations where id = $1`, [call.conversationId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const eventsAfter = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from call_events`),
    );
    expect(eventsAfter.rows[0]?.n).toBe(eventsBefore.rows[0]?.n);
  });
});
