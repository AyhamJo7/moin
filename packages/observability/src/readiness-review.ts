/**
 * Production readiness review (P17.12.01, final P17 PILOT slice): checklist
 * aggregating the P17.01–.08+.11 gates — alarms, dashboards, backups,
 * rotation, access, WAF, scanning, runbooks, canary, fallbacks, kill
 * switches — each with evidence, plus the sign-off record.
 */

export type ReadinessGate =
  | 'alarms'
  | 'dashboards'
  | 'backups'
  | 'rotation'
  | 'access'
  | 'waf'
  | 'scanning'
  | 'runbooks'
  | 'canary'
  | 'fallbacks'
  | 'killswitches';

const GATES: readonly ReadinessGate[] = [
  'alarms',
  'dashboards',
  'backups',
  'rotation',
  'access',
  'waf',
  'scanning',
  'runbooks',
  'canary',
  'fallbacks',
  'killswitches',
];

/** Every readiness gate in checklist order. */
export function readinessGates(): readonly ReadinessGate[] {
  return GATES;
}

export interface ReadinessReview {
  readonly evidence: Readonly<Record<ReadinessGate, boolean>>;
  readonly signedOff: boolean;
}

/** True when every gate holds evidence and the review is signed off. */
export function readinessComplete(review: ReadinessReview): boolean {
  for (const gate of GATES) {
    if (!review.evidence[gate]) return false;
  }
  return review.signedOff;
}
