/**
 * Abuse, cost and concurrency caps (P11.12, LG-P17).
 *
 * Per-caller rate limit (> 5 calls/hour → fallback, no AI), per-tenant
 * concurrent AI session cap (default 3, excess → fallback with callback
 * capture), max call duration + max NLU turns (→ deterministic wrap-up),
 * monthly allowance with 80 %/100 % alerts and optional hard cap, and a
 * per-tenant block list. Pure checks over caller-supplied counters — the
 * counters live in Valkey/DB behind the caller; this module owns the
 * thresholds and the refusal reasons, nothing else.
 */

export const CALLER_HOURLY_LIMIT = 5;
export const CONCURRENT_SESSION_CAP = 3;
export const MAX_CALL_DURATION_MS = 15 * 60_000;
export const MAX_NLU_TURNS = 30;
export const ALLOWANCE_WARN_PCT = 80;
export const ALLOWANCE_CAP_PCT = 100;

export const ABUSE_BLOCKED_METRIC = 'voice.abuse.blocked' as const;

export type CapRefusal =
  | 'caller-rate-limited'
  | 'concurrent-cap'
  | 'duration-cap'
  | 'nlu-turn-cap'
  | 'allowance-exhausted'
  | 'blocked-number';

export interface CapCounters {
  readonly callerCallsLastHour: number;
  readonly activeSessions: number;
  readonly callDurationMs: number;
  readonly nluTurns: number;
  readonly allowanceUsedPct: number;
  readonly allowanceHardCap: boolean;
  readonly blockedNumbers: ReadonlySet<string>;
}

export function checkCaps(
  caller: string,
  counters: CapCounters,
): { readonly ok: true } | { readonly ok: false; readonly refusal: CapRefusal } {
  if (counters.blockedNumbers.has(caller)) return { ok: false, refusal: 'blocked-number' };
  if (counters.callerCallsLastHour > CALLER_HOURLY_LIMIT) {
    return { ok: false, refusal: 'caller-rate-limited' };
  }
  if (counters.activeSessions >= CONCURRENT_SESSION_CAP) {
    return { ok: false, refusal: 'concurrent-cap' };
  }
  if (counters.callDurationMs >= MAX_CALL_DURATION_MS) {
    return { ok: false, refusal: 'duration-cap' };
  }
  if (counters.nluTurns >= MAX_NLU_TURNS) return { ok: false, refusal: 'nlu-turn-cap' };
  if (counters.allowanceHardCap && counters.allowanceUsedPct >= ALLOWANCE_CAP_PCT) {
    return { ok: false, refusal: 'allowance-exhausted' };
  }
  return { ok: true };
}

/** Alert level for allowance tracking: none, warn at 80 %, exhausted at 100 %. */
export function allowanceAlert(usedPct: number): 'none' | 'warn' | 'exhausted' {
  if (usedPct >= ALLOWANCE_CAP_PCT) return 'exhausted';
  if (usedPct >= ALLOWANCE_WARN_PCT) return 'warn';
  return 'none';
}
