/**
 * Model/prompt rollout and rollback (P10.15.01/.02 [G:LAUNCH]): shadow mode
 * parallel-run with comparison, canary tenant flag → all, rollback to the
 * previous version set. Runbook model-change.md (P15.09) + drill ride
 * separately. Synthetic-only (INV-16).
 */

export type VersionSet = string;

/** Shadow comparison: new output matches the current within tolerance. */
export function shadowCompares(current: string, candidate: string): boolean {
  return current.trim() === candidate.trim();
}

export type RolloutStage = 'shadow' | 'canary' | 'all' | 'rolledback';

/** Canary gate: advance only when the canary tenant passes eval. */
export function canaryGates(canaryPass: boolean, stage: RolloutStage): RolloutStage {
  if (stage !== 'canary') return stage;
  return canaryPass ? 'all' : 'rolledback';
}

/** Rollback: restore the previous version set. */
export function rollbackRestores(previous: VersionSet, current: VersionSet): VersionSet {
  if (previous.trim().length === 0) throw new RangeError('previous version set required');
  if (current.trim().length === 0) throw new RangeError('current version set required');
  return previous;
}
