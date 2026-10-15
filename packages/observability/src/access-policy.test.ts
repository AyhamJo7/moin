/**
 * Production access (P17.08): enforces + elevation-gated.
 */
import { describe, expect, it } from 'vitest';
import { accessPath, elevationAllowed } from './access-policy.ts';

describe('production access policy', () => {
  it('enforces the policy: no routine access without elevation', () => {
    expect(
      elevationAllowed({ role: 'operator', approved: true, audited: true, timeBoxMinutes: 60 }),
    ).toBe(true);
    expect(
      elevationAllowed({ role: 'operator', approved: false, audited: true, timeBoxMinutes: 60 }),
    ).toBe(false);
    expect(
      elevationAllowed({ role: 'operator', approved: true, audited: false, timeBoxMinutes: 60 }),
    ).toBe(false);
    expect(
      elevationAllowed({ role: 'operator', approved: true, audited: true, timeBoxMinutes: 0 }),
    ).toBe(false);
  });

  it('gates elevation per role with the break-glass link', () => {
    expect(accessPath('viewer')).toBe('ops-cli-read');
    expect(accessPath('operator')).toBe('ops-cli-mutate');
    expect(accessPath('breakglass')).toBe('breakglass');
  });
});
