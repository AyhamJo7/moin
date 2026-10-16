/**
 * Multi-customer validation + Front Office launch (P32 SELL, engineering
 * shapes): validation matrix (paying tenants × days live × verticals × SEV1
 * state) + launch checklist + go-live sign-off. Live tenants and billing
 * ride founder-side; this module is the gate shapes.
 */

export interface ValidationMatrix {
  readonly payingTenants: number;
  readonly daysLive: number;
  readonly nonRestaurant: number;
  readonly sev1Unresolved: number;
}

/** Matrix complete: ≥ 3 paying × ≥ 30 days × ≥ 1 non-restaurant × 0 SEV1. */
export function matrixComplete(matrix: ValidationMatrix): boolean {
  if (!Number.isInteger(matrix.payingTenants) || matrix.payingTenants < 3) return false;
  if (!Number.isInteger(matrix.daysLive) || matrix.daysLive < 30) return false;
  if (!Number.isInteger(matrix.nonRestaurant) || matrix.nonRestaurant < 1) return false;
  if (matrix.sev1Unresolved !== 0) return false;
  return true;
}

export type LaunchItem = 'entitlements' | 'billing' | 'support' | 'onboarding' | 'signoff';

/** Launch checklist items in order. */
export function launchChecklist(): readonly LaunchItem[] {
  return ['entitlements', 'billing', 'support', 'onboarding', 'signoff'];
}

/** True when every checklist item holds evidence plus sign-off. */
export function checklistPasses(evidence: Readonly<Record<LaunchItem, boolean>>): boolean {
  for (const item of launchChecklist()) {
    if (!evidence[item]) return false;
  }
  return true;
}

export interface GoLiveSignoff {
  readonly signer: string;
  readonly dateIso: string;
}

/** Valid sign-off: non-empty signer + valid ISO date (YYYY-MM-DD). */
export function signoffValid(signoff: GoLiveSignoff): boolean {
  if (signoff.signer.trim().length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signoff.dateIso)) return false;
  const date = new Date(`${signoff.dateIso}T00:00:00Z`);
  return !Number.isNaN(date.getTime());
}

/** Launch gate: checklist passes AND a valid go-live sign-off is recorded. */
export function launchReady(
  evidence: Readonly<Record<LaunchItem, boolean>>,
  signoff: GoLiveSignoff,
): boolean {
  return checklistPasses(evidence) && signoffValid(signoff);
}
