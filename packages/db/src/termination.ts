/**
 * Tenant termination and deletion lifecycle (P16.06.01/.02 [G:LAUNCH]):
 * request → 30-day grace (AI answering off, export available, forwarding
 * reminder) → cascade delete of tenant rows with billing retained 8 years +
 * ledger tombstones. The live cascade and certificate (P16.06.03/.04) ride
 * separately; this module is the state machine.
 */

export type TenantState = 'active' | 'terminating' | 'deleted';

/** Grace period in days (P16.06.01). */
export const TERMINATION_GRACE_DAYS = 30;

export interface Termination {
  readonly state: TenantState;
  readonly requestedDaysAgo: number;
  readonly exportDone: boolean;
}

/** Advance the state: active → terminating on request; → deleted past grace. */
export function terminationState(requested: boolean, daysAgo: number): TenantState {
  if (!requested) return 'active';
  if (!Number.isFinite(daysAgo) || daysAgo < 0) throw new RangeError('age must be ≥ 0');
  return daysAgo >= TERMINATION_GRACE_DAYS ? 'deleted' : 'terminating';
}

/** True when the cascade may run: deleted state + export done (P16.06.02). */
export function cascadeAllowed(termination: Termination): boolean {
  return termination.state === 'deleted' && termination.exportDone;
}
