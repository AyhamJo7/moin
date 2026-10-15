/**
 * DR plan (P17.11.01, engineering shape): RTO/RPO targets + ordered failover
 * steps + verify + rollback. The tabletop (P17.11.03) and live timings ride
 * the founder drill; P17.09/P17.10 are LAUNCH per PLAN (skipped with note).
 */

/** Provisional RTO/RPO in hours (P17.11.01: 24–48 h). */
export const DR_RTO_HOURS = 48;
export const DR_RPO_HOURS = 24;

export type DrStep = 'declare' | 'failover' | 'verify' | 'rollback-ready';

/** Ordered failover steps. */
export function drSteps(): readonly DrStep[] {
  return ['declare', 'failover', 'verify', 'rollback-ready'];
}

export interface DrPlan {
  readonly rtoHours: number;
  readonly rpoHours: number;
  readonly stepsCompleted: readonly DrStep[];
  readonly verified: boolean;
}

/** True when the plan is complete: targets met, steps ordered, verified. */
export function drPlanComplete(plan: DrPlan): boolean {
  if (plan.rtoHours > DR_RTO_HOURS || plan.rpoHours > DR_RPO_HOURS) return false;
  const steps = drSteps();
  if (plan.stepsCompleted.length !== steps.length) return false;
  for (let i = 0; i < steps.length; i++) {
    if (plan.stepsCompleted[i] !== steps[i]) return false;
  }
  return plan.verified;
}
