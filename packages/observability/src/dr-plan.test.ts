/**
 * DR plan (P17.11): complete + steps-ordered.
 */
import { describe, expect, it } from 'vitest';
import { drPlanComplete, drSteps, DR_RPO_HOURS, DR_RTO_HOURS } from './dr-plan.ts';

describe('dr plan', () => {
  it('completes with ordered steps inside RTO/RPO', () => {
    expect(DR_RTO_HOURS).toBe(48);
    expect(DR_RPO_HOURS).toBe(24);
    expect(drSteps()).toEqual(['declare', 'failover', 'verify', 'rollback-ready']);
    expect(
      drPlanComplete({
        rtoHours: 48,
        rpoHours: 24,
        stepsCompleted: [...drSteps()],
        verified: true,
      }),
    ).toBe(true);
    expect(
      drPlanComplete({
        rtoHours: 49,
        rpoHours: 24,
        stepsCompleted: [...drSteps()],
        verified: true,
      }),
    ).toBe(false);
    expect(
      drPlanComplete({
        rtoHours: 48,
        rpoHours: 24,
        stepsCompleted: ['failover', 'declare', 'verify', 'rollback-ready'],
        verified: true,
      }),
    ).toBe(false);
    expect(
      drPlanComplete({
        rtoHours: 48,
        rpoHours: 24,
        stepsCompleted: [...drSteps()],
        verified: false,
      }),
    ).toBe(false);
  });
});
