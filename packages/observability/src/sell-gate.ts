/**
 * FULL SELL-READY aggregate gate (P33.02/.03 [G:SELL], SELL EXIT GATE):
 * discrete enumeration — SELL phases, the four category states, security
 * posture, S1-free window, SELL externals, founder sign-off — with per-item
 * gap reporting (P18.12 PG-3 pattern). Honest NOT_READY on the live ledger;
 * no fake completion. Live evidence compilation (P33.01) rides founder-side.
 */

export type SellPhase =
  | 'P07'
  | 'P09'
  | 'P10'
  | 'P11'
  | 'P12'
  | 'P13'
  | 'P14'
  | 'P15'
  | 'P16'
  | 'P17'
  | 'P18'
  | 'P20'
  | 'P21'
  | 'P22'
  | 'P27'
  | 'P28'
  | 'P29'
  | 'P30'
  | 'P31'
  | 'P32';

export const SELL_PHASES: readonly SellPhase[] = [
  'P07',
  'P09',
  'P10',
  'P11',
  'P12',
  'P13',
  'P14',
  'P15',
  'P16',
  'P17',
  'P18',
  'P20',
  'P21',
  'P22',
  'P27',
  'P28',
  'P29',
  'P30',
  'P31',
  'P32',
];

export type SellCategory = 'technical' | 'operational' | 'legal' | 'commercial';

export const SELL_CATEGORIES: readonly SellCategory[] = [
  'technical',
  'operational',
  'legal',
  'commercial',
];

export type SellExt = 'EXT-02' | 'EXT-03' | 'EXT-04' | 'EXT-05' | 'EXT-08' | 'EXT-13';

export const SELL_EXTS: readonly SellExt[] = [
  'EXT-02',
  'EXT-03',
  'EXT-04',
  'EXT-05',
  'EXT-08',
  'EXT-13',
];

export type SellVerdict = 'READY' | 'NOT_READY';

export interface SellInputs {
  readonly phasesVerified: Readonly<Record<SellPhase, boolean>>;
  readonly categoriesMet: Readonly<Record<SellCategory, boolean>>;
  readonly noOpenCritHigh: boolean;
  readonly s1FreeDays: number;
  readonly externalsMet: Readonly<Record<SellExt, boolean>>;
  readonly founderSigned: boolean;
}

/** Aggregate: READY only when every discrete item holds. */
export function sellGate(inputs: SellInputs): SellVerdict {
  return sellGaps(inputs).length === 0 ? 'READY' : 'NOT_READY';
}

/** One gap per unmet item: phase, category, posture, S1, EXT, sign-off. */
export function sellGaps(inputs: SellInputs): readonly string[] {
  const gaps: string[] = [];
  for (const phase of SELL_PHASES) {
    if (!inputs.phasesVerified[phase]) gaps.push(phase);
  }
  for (const category of SELL_CATEGORIES) {
    if (!inputs.categoriesMet[category]) gaps.push(category);
  }
  if (!inputs.noOpenCritHigh) gaps.push('openCritHigh');
  if (!Number.isInteger(inputs.s1FreeDays) || inputs.s1FreeDays < 30) gaps.push('s1Window');
  for (const ext of SELL_EXTS) {
    if (!inputs.externalsMet[ext]) gaps.push(ext);
  }
  if (!inputs.founderSigned) gaps.push('founderSigned');
  return gaps;
}
