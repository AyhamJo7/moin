/**
 * Transfer and handoff (P11.10 LAUNCH): warm-context + cold-fallback.
 */
import { describe, expect, it } from 'vitest';
import { handoffValid, targetValid, transferMode } from './transfer.ts';

describe('transfer and handoff', () => {
  it('validates warm targets with loop prevention', () => {
    const base = { sourceLine: '+491001', calledNumber: '+492002', verified: true } as const;
    expect(handoffValid({ ...base, target: '+493003456789' })).toBe(true);
    expect(handoffValid({ ...base, target: '+493003456789', verified: false })).toBe(false);
    expect(handoffValid({ ...base, target: '+491001' })).toBe(false);
    expect(handoffValid({ ...base, target: '+492002' })).toBe(false);
    expect(targetValid('+493003456789')).toBe(true);
    expect(targetValid('+12025550100')).toBe(false);
  });

  it('falls back cold without context', () => {
    expect(transferMode(true)).toBe('warm-context');
    expect(transferMode(false)).toBe('cold-fallback');
  });
});
