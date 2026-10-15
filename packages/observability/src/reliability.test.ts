/**
 * Reliability hardening (P31 SELL): slo-holds + shed-fires + scale + dr-cost.
 */
import { describe, expect, it } from 'vitest';
import { drCostHolds, scaleMeets, shedFires, sloHolds } from './reliability.ts';

describe('reliability hardening', () => {
  it('holds SLOs within bounds', () => {
    expect(
      sloHolds({ turnP95Ms: 1_700, apiReadP95Ms: 300, apiWriteP95Ms: 700, errorRate: 0.001 }),
    ).toBe(true);
    expect(
      sloHolds({ turnP95Ms: 1_800, apiReadP95Ms: 300, apiWriteP95Ms: 700, errorRate: 0.001 }),
    ).toBe(false);
    expect(
      sloHolds({ turnP95Ms: 1_700, apiReadP95Ms: 300, apiWriteP95Ms: 700, errorRate: 0.01 }),
    ).toBe(false);
  });

  it('fires load-shedding past queue/CPU bounds', () => {
    expect(shedFires({ queueAgeMs: 0, dbCpu: 0.2 })).toBe(false);
    expect(shedFires({ queueAgeMs: 300_001, dbCpu: 0.2 })).toBe(true);
    expect(shedFires({ queueAgeMs: 0, dbCpu: 0.61 })).toBe(true);
  });

  it('meets scale targets with headroom', () => {
    expect(scaleMeets({ sessions: 100, apiRps: 50, headroom: 1.5 })).toBe(true);
    expect(scaleMeets({ sessions: 99, apiRps: 50, headroom: 1.5 })).toBe(false);
    expect(scaleMeets({ sessions: 100, apiRps: 49, headroom: 1.5 })).toBe(false);
    expect(scaleMeets({ sessions: 100, apiRps: 50, headroom: 1.4 })).toBe(false);
  });

  it('holds DR-cost guardrails', () => {
    const ok = { rtoHours: 48, rpoHours: 24, costPerTenantMicros: 900, cogsLimitMicros: 1000 };
    expect(drCostHolds({ ...ok })).toBe(true);
    expect(drCostHolds({ ...ok, rtoHours: 49 })).toBe(false);
    expect(drCostHolds({ ...ok, rpoHours: 25 })).toBe(false);
    expect(drCostHolds({ ...ok, costPerTenantMicros: 1001 })).toBe(false);
  });
});
