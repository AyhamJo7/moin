/**
 * Outcome writing (P12.12, INV-06/11).
 *
 * On call end: exactly one outcome per CallSid — handled-automatically
 * (FAQ resolved, request captured) or needs-attention — plus the rows the
 * turn produced (task/lead/request intents). Duplicate end events collapse
 * to the first outcome (INV-11); the DB writer (contact resolution P07.03,
 * conversation, audit, SSE) rides separately. Pure, no I/O.
 */

export type OutcomeKind = 'handled-automatically' | 'needs-attention';

export interface CallOutcome {
  readonly callSid: string;
  readonly kind: OutcomeKind;
  readonly rows: readonly ('task' | 'lead' | 'request')[];
}

export function createOutcomeWriter(): {
  readonly write: (
    callSid: string,
    kind: OutcomeKind,
    rows: readonly ('task' | 'lead' | 'request')[],
  ) => CallOutcome | null;
} {
  const written = new Set<string>();
  return {
    // Returns null on duplicate end events — the first outcome stands.
    write(callSid, kind, rows): CallOutcome | null {
      if (written.has(callSid)) return null;
      written.add(callSid);
      return { callSid, kind, rows: [...rows] };
    },
  };
}
