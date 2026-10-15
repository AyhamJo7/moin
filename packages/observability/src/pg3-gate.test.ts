/**
 * PG-3 gate (P18.12): discrete per-item aggregation with named gaps.
 */
import { describe, expect, it } from 'vitest';
import {
  EXT_GATES,
  PILOT_PHASES,
  PLATFORM_GATES,
  VOICE_GATES,
  gateGaps,
  pg3Gate,
  type ExtGate,
  type GateInputs,
  type PlatformGate,
  type PilotPhase,
  type VoiceGate,
} from './pg3-gate.ts';

function fullInputs(): GateInputs {
  const phases = Object.fromEntries(PILOT_PHASES.map((p) => [p, true])) as Record<
    PilotPhase,
    boolean
  >;
  const voice = Object.fromEntries(VOICE_GATES.map((g) => [g, true])) as Record<VoiceGate, boolean>;
  const platform = Object.fromEntries(PLATFORM_GATES.map((g) => [g, true])) as Record<
    PlatformGate,
    boolean
  >;
  const externals = Object.fromEntries(EXT_GATES.map((e) => [e, true])) as Record<ExtGate, boolean>;
  return {
    phasesVerified: phases,
    voiceMet: voice,
    platformMet: platform,
    externalsMet: externals,
    founderSigned: true,
  };
}

describe('pg-3 readiness gate', () => {
  it('aggregates per item: READY only when every item holds', () => {
    expect(pg3Gate(fullInputs())).toBe('READY');
    const base = fullInputs();
    expect(pg3Gate({ ...base, phasesVerified: { ...base.phasesVerified, P06: false } })).toBe(
      'NOT_READY',
    );
    expect(pg3Gate({ ...base, voiceMet: { ...base.voiceMet, 'LG-V01': false } })).toBe('NOT_READY');
    expect(pg3Gate({ ...base, platformMet: { ...base.platformMet, 'LG-P01': false } })).toBe(
      'NOT_READY',
    );
    expect(pg3Gate({ ...base, externalsMet: { ...base.externalsMet, 'EXT-16': false } })).toBe(
      'NOT_READY',
    );
    expect(pg3Gate({ ...base, founderSigned: false })).toBe('NOT_READY');
  });

  it('names each failing item in the gaps', () => {
    const gaps = gateGaps({
      ...fullInputs(),
      phasesVerified: { ...fullInputs().phasesVerified, P06: false },
      voiceMet: { ...fullInputs().voiceMet, 'LG-V01': false },
      platformMet: { ...fullInputs().platformMet, 'LG-P01': false },
      externalsMet: { ...fullInputs().externalsMet, 'EXT-16': false },
      founderSigned: false,
    });
    expect(gaps).toEqual(['P06', 'LG-V01', 'LG-P01', 'EXT-16', 'founderSigned']);
    expect(gateGaps(fullInputs())).toEqual([]);
  });
});
