/**
 * Call finalisation (P11.06, FS-01, INV-06/11).
 *
 * Whichever arrives first — status callback or `<Connect action>` report —
 * finalises the call exactly once: one outcome, one usage record, one
 * notification set. Dedup key is (CallSid, status, sequence): repeats and
 * out-of-order deliveries collapse to a single finalisation. Monotonic
 * ladder: initiated < ringing < in_progress < completed, with
 * failed/busy/no_answer terminal — a late callback never moves the call
 * backwards. Pure, so the permutation test needs no database; the DB writer
 * (upsert `calls` + `call_events` + outcome) rides separately.
 */

export type CallStatus =
  'initiated' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'busy' | 'no_answer';

const LADDER: readonly CallStatus[] = ['initiated', 'ringing', 'in_progress', 'completed'];

function rank(status: CallStatus): number {
  const ladder = LADDER.indexOf(status);
  return ladder === -1 ? LADDER.length : ladder;
}

export interface StatusCallback {
  readonly callSid: string;
  readonly status: CallStatus;
  readonly sequence: number;
  readonly callDurationSecs?: number;
}

export interface FinalisedCall {
  readonly callSid: string;
  readonly status: CallStatus;
  readonly callDurationSecs: number;
  readonly finalised: boolean;
}

export function createFinaliser(): {
  readonly ingest: (callback: StatusCallback) => FinalisedCall | null;
} {
  const seen = new Set<string>();
  const calls = new Map<string, { status: CallStatus; duration: number; done: boolean }>();
  return {
    ingest(callback: StatusCallback): FinalisedCall | null {
      // Dedup: same (CallSid, status, sequence) twice is one delivery.
      const key = `${callback.callSid}|${callback.status}|${callback.sequence}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const current = calls.get(callback.callSid) ?? {
        status: 'initiated' as CallStatus,
        duration: 0,
        done: false,
      };
      // Monotonic: a late callback never moves the call backwards.
      if (rank(callback.status) < rank(current.status)) return null;
      // Terminal states finalise once; later deliveries (any status) are kept
      // as events upstream but change nothing here (INV-11).
      if (current.done) return null;
      const terminal =
        callback.status === 'completed' ||
        callback.status === 'failed' ||
        callback.status === 'busy' ||
        callback.status === 'no_answer';
      const next = {
        status: callback.status,
        duration: callback.callDurationSecs ?? current.duration,
        done: terminal,
      };
      calls.set(callback.callSid, next);
      if (!terminal) return null;
      return {
        callSid: callback.callSid,
        status: next.status,
        callDurationSecs: next.duration,
        finalised: true,
      };
    },
  };
}
