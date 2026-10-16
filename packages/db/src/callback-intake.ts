/**
 * A completed call in which the caller asked to be called back (P12.09.01, P12.12.01).
 *
 * One transaction writes everything the call produced: the call and its conversation (keyed by
 * the provider CallSid), the `completed` status, the `callback_requested` outcome and the
 * callback task linked to the conversation. Repeated delivery of the same CallSid is a replay:
 * `ingestCall` serialises same-SID ingests under an advisory lock and finds the recorded call;
 * when this capture's own task (deterministic key `callback:<conversation>`) exists, it is
 * returned with nothing written (INV-11). A call first recorded by another path gets its task
 * now; if the finaliser's fallback already exists it carries the request and is made live work
 * again (done reopens; cancelled gets a replacement), because the outcome this writes ends
 * every later repair. The conversation lock is the finaliser's, so the two never race.
 *
 * Runs inside `withTenant`; the organisation is whatever the caller entered, which for calls is
 * the dialled number's route — never a value from the event body (INV-02).
 */

import { advanceCallStatus, getOutcome, ingestCall, recordOutcome } from './conversations.ts';
import { createTask, reopenTask } from './tasks.ts';
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
    // This capture's own task (any state, any type): a true replay, nothing written. A task
    // the owner has since completed stays completed.
    const own = await client.query<{ id: string }>(
      'select id from tasks where idempotency_key = $1',
      [callbackKey(conversationId)],
    );
    const replayed = own.rows[0];
    if (replayed !== undefined) return { taskId: replayed.id, conversationId, replayed: true };
  }
  await advanceCallStatus(client, call.id, 'completed');
  await recordCallbackOutcome(client, conversationId);
  if (!created) {
    // Another writer's callback task (the finaliser's fallback) for this call. The
    // one-callback-task-per-interaction index allows no second one, so it carries this request —
    // but only once it is live work again: the outcome recorded above stops the finaliser and
    // the reconciler from ever repairing this conversation, so a closed task must not absorb it.
    const other = await client.query<{ id: string; status: string; version: string }>(
      `select id, status, version::text from tasks
       where conversation_id = $1 and type = 'callback' order by created_at limit 1 for update`,
      [conversationId],
    );
    const found = other.rows[0];
    if (found !== undefined && found.status !== 'cancelled') {
      const live =
        found.status === 'done'
          ? await reopenTask(client, found.id, Number(found.version))
          : { id: found.id };
      return { taskId: live.id, conversationId, replayed: false };
    }
    if (found !== undefined) {
      // Cancelled is terminal. The replacement carries no type, which keeps it outside the
      // one-callback-task-per-interaction index (the finaliser's repair does the same).
      const replacement = await createTask(client, {
        title: input.title,
        priority: 'normal',
        conversationId,
        idempotencyKey: callbackKey(conversationId),
      });
      return { taskId: replacement.id, conversationId, replayed: false };
    }
  }
  const task = await createTask(client, {
    title: input.title,
    type: 'callback',
    priority: 'normal',
    conversationId,
    idempotencyKey: callbackKey(conversationId),
  });
  return { taskId: task.id, conversationId, replayed: false };
}
