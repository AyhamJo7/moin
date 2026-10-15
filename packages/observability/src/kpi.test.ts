/**
 * Founder KPI dashboard (P15.11): kpi-shapes + aggregates.
 */
import { describe, expect, it } from 'vitest';
import { aggregateKpis } from './kpi.ts';

describe('founder KPI dashboard', () => {
  it('shapes ratios from counts', () => {
    expect(
      aggregateKpis({
        callsHandled: 80,
        callsTotal: 100,
        resolved: 60,
        callbacksOnTime: 9,
        callbacksTotal: 10,
        costMicros: 8000,
      }),
    ).toEqual({
      handledShare: 0.8,
      resolutionRate: 0.75,
      callbackSla: 0.9,
      costPerCallMicros: 100,
    });
  });

  it('stays zero-safe with no calls', () => {
    expect(
      aggregateKpis({
        callsHandled: 0,
        callsTotal: 0,
        resolved: 0,
        callbacksOnTime: 0,
        callbacksTotal: 0,
        costMicros: 0,
      }),
    ).toEqual({ handledShare: 0, resolutionRate: 0, callbackSla: 0, costPerCallMicros: 0 });
    expect(() =>
      aggregateKpis({
        callsHandled: -1,
        callsTotal: 0,
        resolved: 0,
        callbacksOnTime: 0,
        callbacksTotal: 0,
        costMicros: 0,
      }),
    ).toThrow(RangeError);
  });
});
