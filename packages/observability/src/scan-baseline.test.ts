/**
 * Scan baseline (P17.07): records + transitions.
 */
import { describe, expect, it } from 'vitest';
import { baselineHolds, triageSlaDays } from './scan-baseline.ts';

describe('scan baseline and triage', () => {
  it('records severity buckets with SLA clocks', () => {
    expect(triageSlaDays('critical')).toBe(1);
    expect(triageSlaDays('high')).toBe(7);
    expect(triageSlaDays('medium')).toBe(30);
    expect(triageSlaDays('low')).toBe(90);
  });

  it('transitions triage within SLA, exceptions low-only', () => {
    expect(baselineHolds({ severity: 'high', state: 'open', ageDays: 7 })).toBe(true);
    expect(baselineHolds({ severity: 'high', state: 'open', ageDays: 8 })).toBe(false);
    expect(baselineHolds({ severity: 'low', state: 'excepted', ageDays: 999 })).toBe(true);
    expect(baselineHolds({ severity: 'high', state: 'excepted', ageDays: 1 })).toBe(false);
    expect(baselineHolds({ severity: 'critical', state: 'fixed', ageDays: 999 })).toBe(true);
  });
});
