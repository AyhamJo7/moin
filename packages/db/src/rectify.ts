/**
 * Contact rectification (P16.04.01): verified correction shapes — editable
 * fields, the "manuell korrigiert" marker vs regeneration choice, and the
 * audit note. Pure; the edit path and the audit writer ride separately
 * (P16.04.02 E2E).
 */

export type RectifyField = 'displayName' | 'phone' | 'email' | 'notes';

export const RECTIFY_FIELDS: readonly RectifyField[] = ['displayName', 'phone', 'email', 'notes'];

/** Owner-facing marker for a hand-corrected summary (German). */
export const CORRECTED_MARKER = 'manuell korrigiert';

export interface RectifyRequest {
  readonly field: RectifyField;
  readonly oldValue: string;
  readonly newValue: string;
  readonly regenerateSummary: boolean;
}

/** True when the request is well-formed: known field, real change. */
export function rectifyValid(request: RectifyRequest): boolean {
  if (!RECTIFY_FIELDS.includes(request.field)) return false;
  const next = request.newValue.trim();
  if (next.length === 0 || next.length > 320) return false;
  return next !== request.oldValue;
}

/** Summary line after rectification: marker or regeneration note. */
export function rectifySummaryNote(request: RectifyRequest): string {
  if (request.regenerateSummary) return 'Zusammenfassung neu erstellt.';
  return `Zusammenfassung ${CORRECTED_MARKER}.`;
}

/** Audit note for the correction event (field + marker, never the values). */
export function rectifyAuditNote(request: RectifyRequest): string {
  return `rectified ${request.field} (${CORRECTED_MARKER})`;
}
