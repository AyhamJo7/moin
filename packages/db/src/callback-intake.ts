/**
 * A completed call in which the caller asked to be called back (P12.09.01, P12.12.01, P12.12.03).
 *
 * One transaction applies the request and records that it did: the call (keyed by provider
 * CallSid), its `completed` status, the `callback_requested` outcome, the task that carries the
 * request, and a `callback_acceptances` row. That row is the replay marker. A later delivery for
 * the same call finds it and changes nothing — not the task's status, version or title, not the
 * call, not the audit trail — however the task came to carry the request and whatever the owner
 * has done with it since (INV-11). The same call with a *different* request is a conflict and
 * writes nothing; a new call is a new request.
 *
 * Locks, always in this order: the CallSid advisory lock (taken here first, then again —
 * re-entrantly — by `ingestCall`), then the conversation lock the finaliser also takes, then the
 * task row. Concurrent deliveries of one call serialise on the first; a concurrent finalise on the
 * second. The replay check runs under the first lock and before any write, so a replay writes
 * nothing even when the call or conversation has been erased since.
 *
 * Which task carries the request:
 * - a new call: a new `callback` task with the request's summary;
 * - an existing call with live finaliser work (its fallback or repair task, recognised by its
 *   key and still bearing its fixed title): that task, keeping its identity and status, retitled
 *   to the summary;
 * - an existing call whose callback task someone already closed or retitled: that task stays as
 *   it is, and a new task carries the request (no type, which keeps it outside the
 *   one-callback-task-per-interaction index, as the finaliser's own repair does), so neither the
 *   owner's work nor the summary is lost.
 *
 * Calls captured before migration 0077 have no acceptance row; their `callback_requested`
 * outcome stands in for it, so their replays also write nothing. The task a replay names is
 * the one that capture actually used (see `legacyCarrier`), never an older cancelled fallback.
 *
 * The caller number is write-once on the call (see `settleCallerNumber`).
 *
 * Runs inside `withTenant`; the organisation is whatever the caller entered, which for calls is
 * the dialled number's route — never a value from the event body (INV-02).
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { advanceCallStatus, getOutcome, ingestCall, recordOutcome } from './conversations.ts';
import { FALLBACK_TITLE, REPAIR_TITLE, fallbackKey } from './finaliser.ts';
import { createTask, retitleSystemTask } from './tasks.ts';
import type { TenantClient } from './tenant.ts';

export interface CallbackRequest {
  readonly providerCallSid: string;
  /** The validated E.164 number the call came from: the number the owner calls back. */
  readonly fromNumber: string;
  readonly toNumber: string;
  /** The task title: the normalised request summary, 1..72 characters. */
  readonly title: string;
}

export interface CapturedCallback {
  /**
   * The task carrying the request. Null when it was erased after acceptance, or, for a replay of a
   * call captured before migration 0077, when the carrier cannot be told apart (see `legacyCarrier`).
   */
  readonly taskId: string | null;
  readonly conversationId: string | null;
  /** True when this call's request had already been accepted: nothing was written. */
  readonly replayed: boolean;
}

export type CallbackConflict = 'request-differs' | 'caller-differs';

/**
 * The delivery cannot be applied without discarding information, so nothing was written:
 * - `request-differs`: this call already has an accepted callback request with other content;
 * - `caller-differs`: the call already records a different calling number.
 */
export class CallbackConflictError extends Error {
  public override readonly name = 'CallbackConflictError';
  public readonly reason: CallbackConflict;

  constructor(reason: CallbackConflict) {
    super(`callback request conflicts with the recorded call (${reason})`);
    this.reason = reason;
  }
}

/** Titles only the system writes: replacing them loses nothing anyone chose. */
const SYSTEM_TITLES: readonly string[] = [FALLBACK_TITLE, REPAIR_TITLE];

/** The carrying task's key. Not `callback:<conversation>`, which the pre-0077 capture used. */
function carrierKey(conversationId: string): string {
  return `callback-request:${conversationId}`;
}

/** The key the pre-0077 capture gave the task it created: also its cancelled-fallback replacement. */
function legacyCarrierKey(conversationId: string): string {
  return `callback:${conversationId}`;
}

/**
 * The task a pre-0077 capture used for this conversation, or null when none can be told apart.
 * Reads only. Three shapes existed, and only the key tells them apart: the type cannot, because
 * the finaliser's fallback is itself typed `callback`.
 * - The capture created its task, or replaced a cancelled fallback with one (that replacement
 *   has no type): the task keyed `callback:<conversation>`, whatever its status now.
 * - The capture adopted a live fallback (reopened if done): no such task exists, and the
 *   carrier is the fallback under its own key, unless it is cancelled. A cancelled fallback with
 *   no keyed task is either a replaced one whose replacement was erased, or an adopted one the
 *   owner cancelled later; nothing in the data tells these apart, so no id is named.
 */
async function legacyCarrier(client: TenantClient, conversationId: string): Promise<string | null> {
  const keyed = await client.query<{ id: string }>(
    'select id from tasks where idempotency_key = $1',
    [legacyCarrierKey(conversationId)],
  );
  if (keyed.rows[0] !== undefined) return keyed.rows[0].id;
  const adopted = await client.query<{ id: string }>(
    `select id from tasks where idempotency_key = $1 and status <> 'cancelled'`,
    [fallbackKey(conversationId)],
  );
  return adopted.rows[0]?.id ?? null;
}

/**
 * Identifies the request content: dialled number and summary. Not the caller number, which the
 * call row holds and the replay check compares directly — a hash over a phone number is a
 * reversible copy of it.
 */
function requestHash(input: CallbackRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([input.toNumber, input.title]))
    .digest('hex');
}

/**
 * The calling number is write-once: an existing call without one gets the accepted number; one
 * that already holds the same number is left alone; one that holds a different number is a
 * conflict, because one call cannot have come from two numbers and guessing which is right would
 * hand the owner a wrong callback number. The recorded value is never overwritten.
 */
async function settleCallerNumber(
  client: TenantClient,
  callId: string,
  fromNumber: string,
): Promise<void> {
  const current = await client.query<{ from_number: string | null }>(
    'select from_number from calls where id = $1 for update',
    [callId],
  );
  const existing = current.rows[0]?.from_number ?? null;
  if (existing === fromNumber) return;
  if (existing !== null) throw new CallbackConflictError('caller-differs');
  await client.query(
    `update calls set from_number = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and from_number is null`,
    [callId, fromNumber],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'call.caller_number',
    targetKind: 'call',
    targetId: callId,
    result: 'succeeded',
  });
}

/** One outcome per conversation: recorded unless one already exists. */
async function recordCallbackOutcome(client: TenantClient, conversationId: string): Promise<void> {
  if ((await getOutcome(client, conversationId)) !== null) return;
  await recordOutcome(client, conversationId, {
    resultCode: 'callback_requested',
    templateIntent: 'callback',
    handledAutomatically: true,
  });
}

/**
 * On an existing call: the finaliser's live task (fallback or repair, recognised by its key and
 * still bearing its fixed title) that will carry the request ('adopt'); otherwise a callback task
 * that someone closed or retitled, which is left exactly as it is ('occupied' — a second task
 * carries the summary, so neither the owner's work nor the request is lost); or nothing ('none').
 */
async function existingCallbackWork(
  client: TenantClient,
  conversationId: string,
  title: string,
): Promise<{ kind: 'adopt'; id: string } | { kind: 'occupied' } | { kind: 'none' }> {
  const finaliserTask = await client.query<{ id: string; title: string; version: string }>(
    `select id, title, version::text from tasks
     where conversation_id = $1 and idempotency_key like 'finaliser-fallback:%'
       and status in ('open', 'in_progress', 'waiting') and title = any($2::text[])
     order by created_at limit 1 for update`,
    [conversationId, SYSTEM_TITLES],
  );
  const adoptable = finaliserTask.rows[0];
  if (adoptable !== undefined) {
    await retitleSystemTask(
      client,
      adoptable.id,
      adoptable.title,
      title,
      Number(adoptable.version),
    );
    return { kind: 'adopt', id: adoptable.id };
  }
  const callbackTask = await client.query<{ id: string }>(
    `select id from tasks where conversation_id = $1 and type = 'callback' limit 1 for update`,
    [conversationId],
  );
  return callbackTask.rows[0] === undefined ? { kind: 'none' } : { kind: 'occupied' };
}

/**
 * The replay check, before anything is written. A first delivery has neither an acceptance nor a
 * callback outcome: the finaliser never writes outcomes, and every capture writes its outcome in
 * the transaction that writes its acceptance. So an acceptance means "applied"; and a
 * `callback_requested` outcome without one means a capture from before migration 0077 recorded
 * acceptances (whether it created its task or adopted a fallback). Reads only. Returns the
 * replay, or null for a first delivery.
 */
async function priorAcceptance(
  client: TenantClient,
  sid: string,
  input: CallbackRequest,
  hash: string,
): Promise<CapturedCallback | null> {
  const recordedCall = await client.query<{ conversation_id: string; from_number: string | null }>(
    'select conversation_id, from_number from calls where provider_call_sid = $1',
    [sid],
  );
  const call = recordedCall.rows[0];
  const accepted = await client.query<{
    task_id: string | null;
    conversation_id: string | null;
    request_hash: string;
  }>(
    `select task_id, conversation_id, request_hash from callback_acceptances
     where provider_call_sid = $1`,
    [sid],
  );
  const prior = accepted.rows[0];
  if (prior !== undefined) {
    if (prior.request_hash !== hash) throw new CallbackConflictError('request-differs');
    const recordedNumber = call?.from_number ?? null;
    if (recordedNumber !== null && recordedNumber !== input.fromNumber) {
      throw new CallbackConflictError('caller-differs');
    }
    return { taskId: prior.task_id, conversationId: prior.conversation_id, replayed: true };
  }
  if (call === undefined) return null;
  const outcome = await getOutcome(client, call.conversation_id);
  if (outcome?.resultCode !== 'callback_requested') return null;
  return {
    taskId: await legacyCarrier(client, call.conversation_id),
    conversationId: call.conversation_id,
    replayed: true,
  };
}

export async function captureCallbackRequest(
  client: TenantClient,
  input: CallbackRequest,
): Promise<CapturedCallback> {
  const sid = input.providerCallSid.trim();
  const hash = requestHash(input);
  // The CallSid lock ingestCall takes (re-entrant within the transaction), taken first so that
  // the replay check runs before anything is written: a replay — even of a call whose
  // conversation has since been erased — must not recreate a single row.
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [sid]);
  const replay = await priorAcceptance(client, sid, input, hash);
  if (replay !== null) return replay;

  const { call, created } = await ingestCall(client, {
    providerCallSid: sid,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
  });
  const conversationId = call.conversationId;
  // The finaliser's lock (same key): a concurrent finalise of this conversation either commits
  // its fallback task first, and is found below, or waits until this capture has committed.
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [conversationId]);

  if (!created) await settleCallerNumber(client, call.id, input.fromNumber);
  await advanceCallStatus(client, call.id, 'completed');
  await recordCallbackOutcome(client, conversationId);
  const existing = created
    ? ({ kind: 'none' } as const)
    : await existingCallbackWork(client, conversationId, input.title);
  const taskId =
    existing.kind === 'adopt'
      ? existing.id
      : (
          await createTask(client, {
            title: input.title,
            // Another callback task keeps its slot in the one-per-interaction index.
            type: existing.kind === 'occupied' ? undefined : 'callback',
            priority: 'normal',
            conversationId,
            idempotencyKey: carrierKey(conversationId),
          })
        ).id;
  await client.query(
    `insert into callback_acceptances
       (organisation_id, id, provider_call_sid, conversation_id, task_id, request_hash)
     values (app.current_org(), $1, $2, $3, $4, $5)`,
    [randomUUID(), sid, conversationId, taskId, hash],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'callback.accept',
    targetKind: 'conversation',
    targetId: conversationId,
    result: 'succeeded',
  });
  return { taskId, conversationId, replayed: false };
}
