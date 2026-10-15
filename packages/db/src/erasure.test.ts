/**
 * Contact erasure (P16.05.04): anonymises, keeps the skeleton.
 */
import { describe, expect, it } from 'vitest';
import { anonymiseContact, erasureAllowed, erasureRecord, ERASED_MARKER } from './erasure.ts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('contact erasure', () => {
  it('anonymises identity fields and keeps the skeleton', () => {
    const erased = anonymiseContact(ID);
    expect(erased.displayName).toBe(ERASED_MARKER);
    expect(erased.phone).toBe(ERASED_MARKER);
    expect(erased.skeletonKept).toBe(true);
    expect(() => anonymiseContact('nope')).toThrow(RangeError);
  });

  it('gates on verified identity and records the ledger line', () => {
    expect(erasureAllowed({ contactId: ID, identityVerified: true })).toBe(true);
    expect(erasureAllowed({ contactId: ID, identityVerified: false })).toBe(false);
    expect(erasureAllowed({ contactId: 'nope', identityVerified: true })).toBe(false);
    expect(erasureRecord(ID)).toBe(`erased ${ID}`);
  });
});
