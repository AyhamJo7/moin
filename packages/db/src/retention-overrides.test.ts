/**
 * Tenant retention overrides (P16.02.03): floor respected, invalid rejected.
 */
import { describe, expect, it } from 'vitest';
import { effectiveDays, overrideValid, retentionFloor } from './retention-overrides.ts';

describe('tenant retention overrides', () => {
  it('respects the statutory floor', () => {
    expect(retentionFloor('notifications')).toBe(90);
    expect(overrideValid('notifications', 90)).toBe(true);
    expect(overrideValid('notifications', 180)).toBe(true);
    expect(overrideValid('notifications', 89)).toBe(false);
  });

  it('rejects invalid overrides and falls back to the default', () => {
    expect(overrideValid('notifications', 90.5)).toBe(false);
    expect(overrideValid('billing', 100)).toBe(false);
    expect(effectiveDays('notifications', 180)).toBe(180);
    expect(effectiveDays('notifications', 10)).toBe(90);
    expect(effectiveDays('notifications', null)).toBe(90);
  });
});
