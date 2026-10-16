/**
 * A completed call in which the caller asked to be called back (P12.09.01, P12.12.01).
 *
 * One transaction writes everything the call produced: the call and its conversation (keyed by
 * the provider CallSid), the `completed` status, the `callback_requested` outcome and the
 * callback task linked to the conversation. Repeated delivery of the same CallSid is a replay:
 * `ingestCall` serialises same-SID ingests under an advisory lock and finds the recorded call;
 * when this capture's own task (deterministic key `callback:<conversation>`) exists, it is
 * returned with nothing written (INV-11). A call first recorded by another path (no task yet)
 * gets its task now. The conversation lock is the finaliser's, so a fallback task and this one
 * can never race into the one-callback-task-per-interaction index.
 *
 * Runs inside `withTenant`; the organisation is whatever the caller entered, which for calls is
 * the dialled number's route — never a value from the event body (INV-02).
 */

import { advanceCallStatus, getOutcome, ingestCall, recordOutcome } from './conversations.ts';
import { createTask } from './tasks.ts';
import type { TenantClient } from './tenant.ts';

export interface CallbackRequest {
  readonly providerCallSid: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  /** The task title: the normalised request summary, 1..72 characters. */
  readonly title: string;
}

export interface CapturedCallback {
  readonly taskId: string;
  readonly conversationId: string;
  /** True when the CallSid had already been recorded and its callback task existed. */
  readonly replayed: boolean;
}

function callbackKey(conversationId: string): string {
  return `callback:${conversationId}`;
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

export async function captureCallbackRequest(
  client: TenantClient,
  input: CallbackRequest,
): Promise<CapturedCallback> {
  const { call, created } = await ingestCall(client, {
    providerCallSid: input.providerCallSid,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
  });
  const conversationId = call.conversationId;
  // The finaliser's lock (same key): a concurrent finalise of this conversation either commits
  // its fallback task first, and is found below, or waits until this capture has committed.
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [conversationId]);
  if (!created) {
    const existing = await client.query<{ id: string; idempotency_key: string | null }>(
      `select id, idempotency_key from tasks where conversation_id = $1 and type = 'callback'
       order by created_at limit 1`,
      [conversationId],
    );
    const found = existing.rows[0];
    // This capture's own task: a true replay, nothing written.
    if (found?.idempotency_key === callbackKey(conversationId)) {
      return { taskId: found.id, conversationId, replayed: true };
    }
    // Another writer's callback task (the finaliser's fallback) already covers the call. The
    // one-system-task-per-interaction-and-type index allows no second one, so it stands for
    // this request, and the call's outcome is recorded if it has none yet.
    if (found !== undefined) {
      await recordCallbackOutcome(client, conversationId);
      return { taskId: found.id, conversationId, replayed: false };
    }
  }
  await advanceCallStatus(client, call.id, 'completed');
  await recordCallbackOutcome(client, conversationId);
  const task = await createTask(client, {
    title: input.title,
    type: 'callback',
    priority: 'normal',
    conversationId,
    idempotencyKey: callbackKey(conversationId),
  });
  return { taskId: task.id, conversationId, replayed: false };
}
