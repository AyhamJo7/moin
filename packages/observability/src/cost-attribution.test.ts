/**
 * Cost attribution (P15.12): attribution-sums + tenant-split.
 */
import { describe, expect, it } from 'vitest';
import { attributionTotal, costAnomaly, tenantCostMicros } from './cost-attribution.ts';

describe('cost attribution', () => {
  it('sums attribution across tenants with a clean split', () => {
    const rates = { voiceMicrosPerMinute: 1_000, smsMicrosEach: 500 } as const;
    const a = tenantCostMicros(
      { tenantId: 'a', voiceMinutes: 10, llmMicros: 2_000, smsCount: 4 },
      { ...rates },
    );
    const b = tenantCostMicros(
      { tenantId: 'b', voiceMinutes: 0, llmMicros: 0, smsCount: 0 },
      { ...rates },
    );
    expect(a).toBe(10_000 + 2_000 + 2_000);
    expect(b).toBe(0);
    expect(attributionTotal({ a, b })).toBe(a);
  });

  it('flags cost above twice the trailing average', () => {
    expect(costAnomaly(201, 100)).toBe(true);
    expect(costAnomaly(200, 100)).toBe(false);
    expect(costAnomaly(0, 0)).toBe(false);
    expect(costAnomaly(1, 0)).toBe(true);
  });
});
