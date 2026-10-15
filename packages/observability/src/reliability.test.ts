/**
 * Reliability hardening (P31 SELL): slo-holds + shed-fires.
 */
import { describe, expect, it } from 'vitest';
import { shedFires, sloHolds } from './reliability.ts';

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
});
