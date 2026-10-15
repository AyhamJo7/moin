/**
 * Synthetic call canary (P15.05.01/.02/.04): scheduled synthetic call through
 * the voice path — disclosure, session, captured callback — with
 * success/latency recorded; alarm on 2 consecutive failures (SEV1). Pure
 * evaluation over caller-supplied run records; the scheduler, harness call
 * and cleanup ride separately. The canary tenant is excluded from business
 * metrics and billing by its tenant flag (P15.05.03), not by this module.
 */

export interface CanaryRun {
  readonly disclosurePlayed: boolean;
  readonly sessionEstablished: boolean;
  readonly callbackCaptured: boolean;
  readonly latencyMs: number;
}

/** Turn-latency bound for a passing run (P95 < 1.8 s per the SLO table). */
export const CANARY_TURN_LATENCY_MS = 1_800;

/** Consecutive failures that raise the SEV1 alarm. */
export const CALL_CANARY_FAIL_LIMIT = 2;

/** True when the run passed the full voice path within the latency bound. */
export function canaryRunOk(run: CanaryRun): boolean {
  return (
    run.disclosurePlayed &&
    run.sessionEstablished &&
    run.callbackCaptured &&
    run.latencyMs <= CANARY_TURN_LATENCY_MS
  );
}

/** True when the trailing run holds CALL_CANARY_FAIL_LIMIT consecutive failures. */
export function callCanaryAlarms(runs: readonly CanaryRun[]): boolean {
  let failures = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (run === undefined) return false;
    if (canaryRunOk(run)) return false;
    failures += 1;
    if (failures >= CALL_CANARY_FAIL_LIMIT) return true;
  }
  return false;
}
