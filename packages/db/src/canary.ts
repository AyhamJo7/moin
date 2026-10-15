/**
 * Synthetic urgent canary (P14.08.01): hourly synthetic urgent notification
 * with delivery-verified latency; alarm on consecutive misses. Pure
 * evaluation over caller-supplied observations; the scheduler and the alarm
 * plumbing ride separately.
 */

/** Alarm threshold: latency past 2 min counts a miss (LG-P12). */
export const CANARY_LATENCY_MS = 120_000;

/** Consecutive misses that raise the alarm. */
export const CANARY_MISS_LIMIT = 2;

export interface CanaryObservation {
  readonly firedAtMs: number;
  readonly deliveredAtMs: number | null;
}

/** True when the canary fired and delivered within the latency bound. */
export function canaryOk(observation: CanaryObservation): boolean {
  if (observation.deliveredAtMs === null) return false;
  return observation.deliveredAtMs - observation.firedAtMs <= CANARY_LATENCY_MS;
}

/** True when the trailing run holds CANARY_MISS_LIMIT consecutive misses. */
export function canaryAlarms(observations: readonly CanaryObservation[]): boolean {
  let misses = 0;
  for (let i = observations.length - 1; i >= 0; i--) {
    const observation = observations[i];
    if (observation === undefined) return false;
    if (canaryOk(observation)) return false;
    misses += 1;
    if (misses >= CANARY_MISS_LIMIT) return true;
  }
  return false;
}
