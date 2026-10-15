/**
 * Call-log reconciliation (P11.09, INV-06).
 *
 * Every 15 min the worker lists Twilio calls to tenant numbers and compares
 * against local `calls` rows: missing-local → backfill task ("Verpasster
 * Anruf – Rückruf"), missing-remote → flag for review, duration mismatch →
 * correct the local record. Idempotent by CallSid: repeated runs change
 * nothing (P11.09.03). Pure diff here; the Twilio list call, the task
 * creation and the 7-day remote delete (P11.09.02, A-23) ride separately.
 */

export interface RemoteCall {
  readonly callSid: string;
  readonly durationSecs: number;
}

export interface LocalCall {
  readonly callSid: string;
  readonly durationSecs: number;
  readonly hasOutcome: boolean;
}

export type ReconcileAction =
  | { readonly kind: 'backfill-task'; readonly callSid: string }
  | { readonly kind: 'flag-missing-remote'; readonly callSid: string }
  | { readonly kind: 'correct-duration'; readonly callSid: string; readonly durationSecs: number };

/**
 * Diff remote against local. A local row without an outcome counts as
 * missing (the call happened, we never finalised it). Exact-duration
 * equality: durations are whole seconds on both sides, no tolerance to tune.
 */
export function reconcileCalls(
  remote: readonly RemoteCall[],
  local: readonly LocalCall[],
): readonly ReconcileAction[] {
  const localBySid = new Map(local.map((c) => [c.callSid, c]));
  const remoteSids = new Set(remote.map((c) => c.callSid));
  const actions: ReconcileAction[] = [];
  for (const r of remote) {
    const outcome = localBySid.get(r.callSid)?.hasOutcome === true;
    if (!outcome) {
      actions.push({ kind: 'backfill-task', callSid: r.callSid });
    } else {
      const duration = localBySid.get(r.callSid)?.durationSecs;
      if (duration !== r.durationSecs) {
        actions.push({
          kind: 'correct-duration',
          callSid: r.callSid,
          durationSecs: r.durationSecs,
        });
      }
    }
  }
  for (const l of local) {
    if (!remoteSids.has(l.callSid)) {
      actions.push({ kind: 'flag-missing-remote', callSid: l.callSid });
    }
  }
  return actions;
}
