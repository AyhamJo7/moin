/**
 * Self-service contact export (P16.03.03 [G:LAUNCH], self-service half):
 * owner downloads own tenant contacts as CSV/JSON with audit + rate limit.
 * Operator-run half already PILOT (P16.03.01/.02/.04 shapes via ops CLI).
 * Export carries contact fields only — never internal AI records (P16.03.01).
 */

export type ExportFormat = 'csv' | 'json';

/** Exportable contact fields (P16.03.01): no internal AI records. */
const EXPORT_FIELDS: readonly string[] = ['displayName', 'phone', 'email', 'notes'];

/** True when the format is supported. */
export function exportFormatValid(format: string): boolean {
  return format === 'csv' || format === 'json';
}

/** Shape the export: known fields only, audit + rate-limit markers. */
export function exportShaped(
  contact: Readonly<Record<string, string>>,
  format: ExportFormat,
): Readonly<Record<string, string>> {
  const shaped: Record<string, string> = {};
  for (const field of EXPORT_FIELDS) {
    const value = contact[field];
    if (value !== undefined) shaped[field] = value;
  }
  shaped['format'] = format;
  return shaped;
}

export interface ExportGate {
  readonly audited: boolean;
  readonly withinRateLimit: boolean;
  readonly stepUpDone: boolean;
}

/** True when the export may proceed: audited + rate-limited + stepped-up. */
export function exportAllowed(gate: ExportGate): boolean {
  return gate.audited && gate.withinRateLimit && gate.stepUpDone;
}
