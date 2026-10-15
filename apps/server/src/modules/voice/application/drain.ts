/**
 * Deployment draining (P11.15, INV-19, FS-12).
 *
 * SIGTERM → readiness false → no new sessions; in-flight calls continue
 * until end or the deregistration delay expires. Calls still active at
 * forced shutdown get the deterministic closing line plus a callback task
 * from the checkpoint (P11.15.02). Pure admission + drain-state here; the
 * SIGTERM wiring and the staging deploy test ride separately.
 */

export type DrainState = 'serving' | 'draining' | 'drained';

export interface DrainTracker {
  readonly state: DrainState;
  readonly inFlight: number;
}

/** Grace period: deregistration delay upper bound (P11.15.01). */
export const DRAIN_GRACE_MS = 30_000;

export function beginDrain(inFlight: number): DrainTracker {
  return { state: inFlight === 0 ? 'drained' : 'draining', inFlight };
}

/** True when a new call may start (serving only — draining refuses). */
export function admitsNew(state: DrainState): boolean {
  return state === 'serving';
}

/** One in-flight call finished; drained when the last one lands. */
export function callFinished(tracker: DrainTracker): DrainTracker {
  const inFlight = Math.max(0, tracker.inFlight - 1);
  return {
    state: tracker.state === 'draining' && inFlight === 0 ? 'drained' : tracker.state,
    inFlight,
  };
}

/** Forced shutdown with calls active → callback tasks from checkpoints. */
export function forcedShutdownTasks(inFlight: number): number {
  return inFlight;
}
