/**
 * Account hardening (P17.02): checklist + all-required.
 */
import { describe, expect, it } from 'vitest';
import { hardeningComplete, hardeningOpen } from './hardening.ts';

const FULL = {
  mfaEnforced: true,
  rootKeysAbsent: true,
  volumesEncrypted: true,
  imdsv2Enforced: true,
} as const;

describe('account hardening', () => {
  it('completes only when every requirement holds', () => {
    expect(hardeningComplete({ ...FULL })).toBe(true);
    expect(hardeningComplete({ ...FULL, mfaEnforced: false })).toBe(false);
    expect(hardeningComplete({ ...FULL, rootKeysAbsent: false })).toBe(false);
    expect(hardeningComplete({ ...FULL, volumesEncrypted: false })).toBe(false);
    expect(hardeningComplete({ ...FULL, imdsv2Enforced: false })).toBe(false);
  });

  it('names the open requirements', () => {
    expect(hardeningOpen({ ...FULL })).toEqual([]);
    expect(hardeningOpen({ ...FULL, mfaEnforced: false, imdsv2Enforced: false })).toEqual([
      'mfaEnforced',
      'imdsv2Enforced',
    ]);
  });
});
