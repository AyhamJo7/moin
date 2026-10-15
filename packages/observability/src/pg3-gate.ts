/**
 * PG-3 readiness review gate (P18.12.01, GATE VERIFICATION slice): aggregate
 * gate over the Status Ledger — every [G:PILOT] section P02–P18 VERIFIED,
 * LG checks met, externals satisfied, go/no-go signed. This shape audits the
 * ledger honestly: with phases NOT_STARTED/IN_PROGRESS and externals open,
 * the gate reports NOT_READY. Claiming READY here would be fake completion.
 */

export type GateVerdict = 'READY' | 'NOT_READY';

export interface GateInputs {
  readonly pilotSectionsVerified: boolean;
  readonly lgChecksMet: boolean;
  readonly externalsSatisfied: boolean;
  readonly founderSigned: boolean;
}

/** Aggregate: READY only when every input holds. */
export function pg3Gate(inputs: GateInputs): GateVerdict {
  if (!inputs.pilotSectionsVerified) return 'NOT_READY';
  if (!inputs.lgChecksMet) return 'NOT_READY';
  if (!inputs.externalsSatisfied) return 'NOT_READY';
  if (!inputs.founderSigned) return 'NOT_READY';
  return 'READY';
}

/** Audit the live ledger state: names each unmet input. */
export function gateGaps(inputs: GateInputs): readonly string[] {
  const gaps: string[] = [];
  if (!inputs.pilotSectionsVerified) gaps.push('pilotSectionsVerified');
  if (!inputs.lgChecksMet) gaps.push('lgChecksMet');
  if (!inputs.externalsSatisfied) gaps.push('externalsSatisfied');
  if (!inputs.founderSigned) gaps.push('founderSigned');
  return gaps;
}
