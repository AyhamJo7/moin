/**
 * Secrets rotation (P17.04): due + gated.
 */
import { describe, expect, it } from 'vitest';
import { breakGlassAllowed, rotationDue, ROTATION_DAYS } from './secrets.ts';

describe('secrets rotation and break-glass', () => {
  it('flags rotation due at 30 days', () => {
    expect(ROTATION_DAYS).toBe(30);
    expect(rotationDue(30)).toBe(true);
    expect(rotationDue(29)).toBe(false);
    expect(() => rotationDue(-1)).toThrow(RangeError);
  });

  it('gates break-glass on dual approval, box, audit', () => {
    expect(breakGlassAllowed({ approvals: 2, timeBoxMinutes: 60, audited: true })).toBe(true);
    expect(breakGlassAllowed({ approvals: 1, timeBoxMinutes: 60, audited: true })).toBe(false);
    expect(breakGlassAllowed({ approvals: 2, timeBoxMinutes: 0, audited: true })).toBe(false);
    expect(breakGlassAllowed({ approvals: 2, timeBoxMinutes: 60, audited: false })).toBe(false);
  });
});
