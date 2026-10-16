/**
 * Kill switch (P18.09): engages + restores.
 */
import { describe, expect, it } from 'vitest';
import { killEngages, normalRestores } from './killswitch.ts';

describe('kill switch and back-to-normal', () => {
  it('engages the kill with apology and callback capture', () => {
    expect(killEngages({ state: 'killed', apologyPlayed: true, callbackCaptured: true })).toBe(
      true,
    );
    expect(killEngages({ state: 'normal', apologyPlayed: true, callbackCaptured: true })).toBe(
      false,
    );
    expect(killEngages({ state: 'killed', apologyPlayed: false, callbackCaptured: true })).toBe(
      false,
    );
  });

  it('restores normal via guide or remote', () => {
    expect(
      normalRestores({ forwardingDisabled: true, ownerGuideShown: true, remoteDone: false }),
    ).toBe(true);
    expect(
      normalRestores({ forwardingDisabled: true, ownerGuideShown: false, remoteDone: true }),
    ).toBe(true);
    expect(
      normalRestores({ forwardingDisabled: false, ownerGuideShown: true, remoteDone: false }),
    ).toBe(false);
    expect(
      normalRestores({ forwardingDisabled: true, ownerGuideShown: false, remoteDone: false }),
    ).toBe(false);
  });
});
