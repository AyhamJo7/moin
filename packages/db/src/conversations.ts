/**
 * Conversations, calls and outcomes (P07.05.02, P07.05.03).
 *
 * All writes run inside `withTenant`. Call rows are idempotent by provider SID (retried webhooks
 * upsert the same row); status follows a monotonic ladder the service holds — an out-of-order
 * callback is kept as a `call_events` row but never moves the rung backwards. Outcomes carry a
 * closed `result_code` plus versioned facts; until the P07.09 schema registry exists only the
 * empty payload is accepted, so an unvalidated fact cannot enter. Every mutation audits with
 * opaque markers only (INV-12).
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type ConversationChannel = 'call' | 'message';
export type ConversationStatus = 'open' | 'handled' | 'needs_action' | 'closed';
export type CallStatus =
  'initiated' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'busy' | 'no_answer';
export type CallEventKind = 'routing' | 'checkpoint' | 'failure' | 'status_change';
export type OutcomeResult =
  | 'handled'
  | 'callback_requested'
  | 'booking_requested'
  | 'complaint'
  | 'spam'
  | 'wrong_number'
  | 'unresolved';

/** Version conflicts surface as 409 at the HTTP layer; this is the typed signal. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const CALL_LADDER: readonly CallStatus[] = [
  'initiated',
  'ringing',
  'in_progress',
  'completed',
  'failed',
  'busy',
  'no_answer',
];

const TERMINAL: ReadonlySet<CallStatus> = new Set(['completed', 'failed', 'busy', 'no_answer']);

const CHANNEL_MARKER: Record<ConversationChannel, number> = { call: 0, message: 1 };
const RESULT_MARKER: Record<OutcomeResult, number> = {
  handled: 0,
  callback_requested: 1,
  booking_requested: 2,
  complaint: 3,
  spam: 4,
  wrong_number: 5,
  unresolved: 6,
};

export interface Conversation {
  readonly id: string;
  readonly channel: ConversationChannel;
  readonly contactId: string | null;
  readonly status: ConversationStatus;
  readonly version: number;
}

export interface Call {
  readonly id: string;
  readonly conversationId: string;
  readonly providerCallSid: string;
  readonly contactId: string | null;
  readonly status: CallStatus;
  readonly version: number;
}

interface ConversationRow extends Record<string, unknown> {
  id: string;
  channel: string;
  contact_id: string | null;
  status: string;
  version: string;
}

interface CallRow extends Record<string, unknown> {
  id: string;
  conversation_id: string;
  provider_call_sid: string;
  contact_id: string | null;
  status: string;
  version: string;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    channel: row.channel as ConversationChannel,
    contactId: row.contact_id,
    status: row.status as ConversationStatus,
    version: Number(row.version),
  };
}

function toCall(row: CallRow): Call {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    providerCallSid: row.provider_call_sid,
    contactId: row.contact_id,
    status: row.status as CallStatus,
    version: Number(row.version),
  };
}

export async function startConversation(
  client: TenantClient,
  input: { channel: ConversationChannel; contactId?: string | undefined },
): Promise<Conversation> {
  const id = randomUUID();
  const result = await client.query<ConversationRow>(
    `insert into conversations (organisation_id, id, channel, contact_id)
     values (app.current_org(), $1, $2, $3)
     returning id, channel, contact_id, status, version::text`,
    [id, input.channel, input.contactId ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('conversation insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'conversation.start',
    targetKind: 'conversation',
    targetId: id,
    argsSanitized: { channel: CHANNEL_MARKER[input.channel] },
    result: 'succeeded',
  });
  return toConversation(row);
}

/**
 * Idempotent call ingest: the provider SID is the key. The INSERT runs unconditionally and the
 * per-tenant SID unique constraint serialises concurrent racers — the loser's conflicting row is
 * discarded (ON CONFLICT DO NOTHING) and the existing row is read back, so a retried webhook
 * returns the first row unchanged. The orphan conversation created alongside the lost call row
 * is deleted in the same transaction (it references nothing).
 */
export async function ingestCall(
  client: TenantClient,
  input: {
    providerCallSid: string;
    fromNumber?: string | undefined;
    toNumber?: string | undefined;
  },
): Promise<{ call: Call; created: boolean }> {
  const sid = input.providerCallSid.trim();
  if (sid.length === 0 || sid.length > 100) throw new RangeError('provider call SID is empty');
  const conversationId = randomUUID();
  await client.query(
    `insert into conversations (organisation_id, id, channel)
     values (app.current_org(), $1, 'call')`,
    [conversationId],
  );
  const created = await client.query<CallRow>(
    `insert into calls
       (organisation_id, id, conversation_id, provider_call_sid, from_number, to_number)
     values (app.current_org(), $1, $2, $3, $4, $5)
     on conflict (organisation_id, provider_call_sid) do nothing
     returning id, conversation_id, provider_call_sid, contact_id, status, version::text`,
    [randomUUID(), conversationId, sid, input.fromNumber ?? null, input.toNumber ?? null],
  );
  const row = created.rows[0];
  if (row === undefined) {
    // Lost the race (or a retry): drop the orphan conversation, return the winner's row.
    await client.query(`delete from conversations where id = $1`, [conversationId]);
    const existing = await client.query<CallRow>(
      `select id, conversation_id, provider_call_sid, contact_id, status, version::text
       from calls where provider_call_sid = $1`,
      [sid],
    );
    const found = existing.rows[0];
    if (found === undefined) throw new Error('conflicting call row vanished');
    return { call: toCall(found), created: false };
  }
  await client.query(
    `insert into call_events (organisation_id, id, call_id, kind, detail)
     values (app.current_org(), $1, $2, 'status_change', 0)`,
    [randomUUID(), row.id],
  );
  return { call: toCall(row), created: true };
}

/**
 * Monotonic status advance: forward rungs from a non-terminal rung apply, and any terminal from
 * a non-terminal rung applies; terminal-to-terminal never moves (completed→failed is a second
 * verdict, not a transition). Every attempt is kept as a `status_change` event; a rejected move
 * leaves the rung untouched. The UPDATE is guarded on the read rung, so concurrent advancers
 * serialise: the loser re-reads, records its event, and reports moved:false.
 */
export async function advanceCallStatus(
  client: TenantClient,
  callId: string,
  next: CallStatus,
): Promise<{ call: Call; moved: boolean }> {
  const current = await client.query<CallRow>(
    `select id, conversation_id, provider_call_sid, contact_id, status, version::text
     from calls where id = $1`,
    [callId],
  );
  const row = current.rows[0];
  if (row === undefined) throw new VersionConflictError(`call ${callId} not found`);
  const rung = row.status as CallStatus;
  const moves =
    rung !== next &&
    !TERMINAL.has(rung) &&
    (TERMINAL.has(next) || CALL_LADDER.indexOf(next) > CALL_LADDER.indexOf(rung));
  if (!moves) {
    await client.query(
      `insert into call_events (organisation_id, id, call_id, kind, detail)
       values (app.current_org(), $1, $2, 'status_change', $3)`,
      [randomUUID(), callId, CALL_LADDER.indexOf(next)],
    );
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'call.status',
      targetKind: 'call',
      targetId: callId,
      argsSanitized: { status: CALL_LADDER.indexOf(rung) },
      result: 'rejected',
    });
    return { call: toCall(row), moved: false };
  }
  const moved = await client.query<CallRow>(
    `update calls set status = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and status = $3
     returning id, conversation_id, provider_call_sid, contact_id, status, version::text`,
    [callId, next, rung],
  );
  const nextRow = moved.rows[0];
  if (nextRow === undefined) {
    // Lost the race: re-read the winner's rung, record the event, report no move.
    const reread = await client.query<CallRow>(
      `select id, conversation_id, provider_call_sid, contact_id, status, version::text
       from calls where id = $1`,
      [callId],
    );
    const kept = reread.rows[0];
    if (kept === undefined) throw new Error('call row vanished');
    await client.query(
      `insert into call_events (organisation_id, id, call_id, kind, detail)
       values (app.current_org(), $1, $2, 'status_change', $3)`,
      [randomUUID(), callId, CALL_LADDER.indexOf(next)],
    );
    return { call: toCall(kept), moved: false };
  }
  await client.query(
    `insert into call_events (organisation_id, id, call_id, kind, detail)
     values (app.current_org(), $1, $2, 'status_change', $3)`,
    [randomUUID(), callId, CALL_LADDER.indexOf(next)],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'call.status',
    targetKind: 'call',
    targetId: callId,
    argsSanitized: { status: CALL_LADDER.indexOf(next) },
    result: 'succeeded',
  });
  return { call: toCall(nextRow), moved: true };
}

export async function recordCallEvent(
  client: TenantClient,
  callId: string,
  kind: CallEventKind,
  detail = 0,
): Promise<void> {
  if (!Number.isInteger(detail) || detail < 0 || detail > 999_999_999) {
    throw new RangeError('event detail must be an opaque non-negative marker');
  }
  await client.query(
    `insert into call_events (organisation_id, id, call_id, kind, detail)
     values (app.current_org(), $1, $2, $3, $4)`,
    [randomUUID(), callId, kind, detail],
  );
}

export interface OutcomeInput {
  readonly resultCode: OutcomeResult;
  readonly templateIntent?: string | undefined;
  readonly factsSchemaVersion?: string | undefined;
  readonly facts?: Readonly<Record<string, unknown>> | undefined;
  readonly handledAutomatically: boolean;
}

/**
 * Outcome writer: one verdict per conversation. Facts validate against the declared schema
 * version — until the P07.09 registry exists only the empty payload is accepted, so an
 * unvalidated fact cannot enter through this path.
 */
export async function recordOutcome(
  client: TenantClient,
  conversationId: string,
  input: OutcomeInput,
): Promise<{ conversationId: string; resultCode: OutcomeResult }> {
  const version = input.factsSchemaVersion ?? 'v0-none';
  const facts = input.facts ?? {};
  // Until the P07.09 registry exists no validator can check a non-empty payload, so any other
  // version is refused outright (the DB CHECK mirrors this: only v0-none rows exist).
  if (version !== 'v0-none') {
    throw new RangeError('facts schema versions need the P07.09 registry');
  }
  if (Object.keys(facts).length > 0) {
    throw new RangeError('facts need a schema version from the P07.09 registry');
  }
  await client.query(
    `insert into interaction_outcomes
       (organisation_id, id, conversation_id, result_code, template_intent,
        facts_schema_version, facts, handled_automatically)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      conversationId,
      input.resultCode,
      input.templateIntent ?? null,
      version,
      JSON.stringify(facts),
      input.handledAutomatically,
    ],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'outcome.record',
    targetKind: 'conversation',
    targetId: conversationId,
    argsSanitized: { result: RESULT_MARKER[input.resultCode] },
    result: 'succeeded',
  });
  return { conversationId, resultCode: input.resultCode };
}

export async function getOutcome(
  client: TenantClient,
  conversationId: string,
): Promise<{ resultCode: OutcomeResult; handledAutomatically: boolean } | null> {
  const result = await client.query<{ result_code: string; handled_automatically: boolean }>(
    `select result_code, handled_automatically from interaction_outcomes where conversation_id = $1`,
    [conversationId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    resultCode: row.result_code as OutcomeResult,
    handledAutomatically: row.handled_automatically,
  };
}
