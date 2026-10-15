/**
 * Model rollout (P10.15 LAUNCH): shadow + canary + rollback.
 */
import { describe, expect, it } from 'vitest';
import { canaryGates, rollbackRestores, shadowCompares } from './rollout.ts';

describe('model rollout and rollback', () => {
  it('compares shadow outputs', () => {
    expect(shadowCompares('a', 'a ')).toBe(true);
    expect(shadowCompares('a', 'b')).toBe(false);
  });

  it('gates canary and restores on rollback', () => {
    expect(canaryGates(true, 'canary')).toBe('all');
    expect(canaryGates(false, 'canary')).toBe('rolledback');
    expect(canaryGates(false, 'shadow')).toBe('shadow');
    expect(rollbackRestores('v1', 'v2')).toBe('v1');
    expect(() => rollbackRestores('', 'v2')).toThrow(RangeError);
  });
});
