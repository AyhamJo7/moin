/**
 * Deletion ledger (P16.07): records + replay applies.
 */
import { describe, expect, it } from 'vitest';
import { ledgerEntryValid, replaySince } from './deletion-ledger.ts';

const ENTRY = {
  refKind: 'contact',
  refId: '11111111-1111-4111-8111-111111111111',
  deletedAtMs: 2_000,
  tombstone: 'tomb:contact:1',
} as const;

describe('deletion ledger', () => {
  it('records ID-only rows with opaque tombstones', () => {
    expect(ledgerEntryValid({ ...ENTRY })).toBe(true);
    expect(ledgerEntryValid({ ...ENTRY, refId: 'nope' })).toBe(false);
    expect(ledgerEntryValid({ ...ENTRY, tombstone: '  ' })).toBe(false);
  });

  it('replays tombstones after the restore point in order', () => {
    const base = { ...ENTRY, deletedAtMs: 2_000, tombstone: 'tomb:contact:1' };
    const later = { ...ENTRY, deletedAtMs: 3_000, tombstone: 'tomb:contact:2' };
    const earlier = { ...ENTRY, deletedAtMs: 1_000, tombstone: 'tomb:contact:0' };
    expect(replaySince([later, earlier, base], 1_500).map((e) => e.tombstone)).toEqual([
      'tomb:contact:1',
      'tomb:contact:2',
    ]);
    expect(replaySince([earlier], 5_000)).toEqual([]);
    expect(() => replaySince([earlier], -1)).toThrow(RangeError);
  });
});
