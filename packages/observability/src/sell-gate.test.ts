/**
 * SELL exit gate (P33): aggregates + all-met (honest: NOT_READY live).
 */
import { describe, expect, it } from 'vitest';
import {
  sellGate,
  sellGaps,
  SELL_CATEGORIES,
  SELL_EXTS,
  SELL_PHASES,
  type SellCategory,
  type SellExt,
  type SellInputs,
  type SellPhase,
} from './sell-gate.ts';

function fullInputs(): SellInputs {
  const phases = Object.fromEntries(SELL_PHASES.map((p) => [p, true])) as Record<
    SellPhase,
    boolean
  >;
  const categories = Object.fromEntries(SELL_CATEGORIES.map((c) => [c, true])) as Record<
    SellCategory,
    boolean
  >;
  const externals = Object.fromEntries(SELL_EXTS.map((e) => [e, true])) as Record<SellExt, boolean>;
  return {
    phasesVerified: phases,
    categoriesMet: categories,
    noOpenCritHigh: true,
    s1FreeDays: 30,
    externalsMet: externals,
    founderSigned: true,
  };
}

describe('sell-ready production gate', () => {
  it('aggregates per item: READY only when every item holds', () => {
    expect(sellGate(fullInputs())).toBe('READY');
    const base = fullInputs();
    expect(sellGate({ ...base, phasesVerified: { ...base.phasesVerified, P20: false } })).toBe(
      'NOT_READY',
    );
    expect(sellGate({ ...base, categoriesMet: { ...base.categoriesMet, legal: false } })).toBe(
      'NOT_READY',
    );
    expect(sellGate({ ...base, noOpenCritHigh: false })).toBe('NOT_READY');
    expect(sellGate({ ...base, s1FreeDays: 29 })).toBe('NOT_READY');
    expect(sellGate({ ...base, externalsMet: { ...base.externalsMet, 'EXT-02': false } })).toBe(
      'NOT_READY',
    );
    expect(sellGate({ ...base, founderSigned: false })).toBe('NOT_READY');
  });

  it('names each failing item in the gaps', () => {
    const base = fullInputs();
    expect(
      sellGaps({
        ...base,
        phasesVerified: { ...base.phasesVerified, P20: false },
        categoriesMet: { ...base.categoriesMet, legal: false },
        externalsMet: { ...base.externalsMet, 'EXT-02': false },
        founderSigned: false,
      }),
    ).toEqual(['P20', 'legal', 'EXT-02', 'founderSigned']);
    expect(sellGaps(fullInputs())).toEqual([]);
  });
});
