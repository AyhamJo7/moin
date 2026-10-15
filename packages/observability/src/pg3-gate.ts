/**
 * PG-3 readiness review gate (P18.12.01, GATE VERIFICATION slice, rework):
 * discrete enumeration — PILOT phases P02–P18, LG voice gates V01–V14, LG
 * platform gates P01/P02/P03/P05/P11/P14, EXT externals, founder sign-off —
 * with per-item gap reporting. Follows the P17.12 readiness-review pattern:
 * named items, one gap per unmet item, honest NOT_READY on the live ledger.
 */

export type PilotPhase =
  | 'P02'
  | 'P03'
  | 'P04'
  | 'P05'
  | 'P06'
  | 'P07'
  | 'P08'
  | 'P09'
  | 'P10'
  | 'P11'
  | 'P12'
  | 'P13'
  | 'P14'
  | 'P15'
  | 'P16'
  | 'P17'
  | 'P18';

export const PILOT_PHASES: readonly PilotPhase[] = [
  'P02',
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
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
];

export type VoiceGate =
  | 'LG-V01'
  | 'LG-V02'
  | 'LG-V03'
  | 'LG-V04'
  | 'LG-V05'
  | 'LG-V06'
  | 'LG-V07'
  | 'LG-V08'
  | 'LG-V09'
  | 'LG-V10'
  | 'LG-V11'
  | 'LG-V12'
  | 'LG-V13'
  | 'LG-V14';

export const VOICE_GATES: readonly VoiceGate[] = [
  'LG-V01',
  'LG-V02',
  'LG-V03',
  'LG-V04',
  'LG-V05',
  'LG-V06',
  'LG-V07',
  'LG-V08',
  'LG-V09',
  'LG-V10',
  'LG-V11',
  'LG-V12',
  'LG-V13',
  'LG-V14',
];

export type PlatformGate = 'LG-P01' | 'LG-P02' | 'LG-P03' | 'LG-P05' | 'LG-P11' | 'LG-P14';

export const PLATFORM_GATES: readonly PlatformGate[] = [
  'LG-P01',
  'LG-P02',
  'LG-P03',
  'LG-P05',
  'LG-P11',
  'LG-P14',
];

export type ExtGate = 'EXT-02A' | 'EXT-05' | 'EXT-06' | 'EXT-10' | 'EXT-11' | 'EXT-12' | 'EXT-16';

export const EXT_GATES: readonly ExtGate[] = [
  'EXT-02A',
  'EXT-05',
  'EXT-06',
  'EXT-10',
  'EXT-11',
  'EXT-12',
  'EXT-16',
];

export type GateVerdict = 'READY' | 'NOT_READY';

export interface GateInputs {
  readonly phasesVerified: Readonly<Record<PilotPhase, boolean>>;
  readonly voiceMet: Readonly<Record<VoiceGate, boolean>>;
  readonly platformMet: Readonly<Record<PlatformGate, boolean>>;
  readonly externalsMet: Readonly<Record<ExtGate, boolean>>;
  readonly founderSigned: boolean;
}

/** Aggregate: READY only when every discrete item holds. */
export function pg3Gate(inputs: GateInputs): GateVerdict {
  return gateGaps(inputs).length === 0 ? 'READY' : 'NOT_READY';
}

/** One gap per unmet item: phase, LG gate, EXT, or sign-off. */
export function gateGaps(inputs: GateInputs): readonly string[] {
  const gaps: string[] = [];
  for (const phase of PILOT_PHASES) {
    if (!inputs.phasesVerified[phase]) gaps.push(phase);
  }
  for (const gate of VOICE_GATES) {
    if (!inputs.voiceMet[gate]) gaps.push(gate);
  }
  for (const gate of PLATFORM_GATES) {
    if (!inputs.platformMet[gate]) gaps.push(gate);
  }
  for (const ext of EXT_GATES) {
    if (!inputs.externalsMet[ext]) gaps.push(ext);
  }
  if (!inputs.founderSigned) gaps.push('founderSigned');
  return gaps;
}
