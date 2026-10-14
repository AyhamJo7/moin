/**
 * Incident management and breach support (P15.10.01/.02): severity shapes,
 * incident log records, and the Art. 33(3) breach information pack. Pure;
 * the tabletop (P15.10.03) and the notification plumbing ride separately.
 */

export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3';

export interface IncidentLog {
  readonly id: string;
  readonly severity: IncidentSeverity;
  readonly title: string;
  readonly openedAtMs: number;
  readonly closedAtMs: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** True when the log record is well-formed (id, severity, title, sane times). */
export function logIsValid(log: IncidentLog): boolean {
  if (!UUID_RE.test(log.id)) return false;
  if (log.title.trim().length === 0 || log.title.length > 160) return false;
  if (!Number.isFinite(log.openedAtMs) || log.openedAtMs < 0) return false;
  if (log.closedAtMs !== null) {
    if (!Number.isFinite(log.closedAtMs) || log.closedAtMs < log.openedAtMs) return false;
  }
  return true;
}

export interface BreachPack {
  readonly nature: string;
  readonly categories: readonly string[];
  readonly approximateSubjects: number;
  readonly consequences: string;
  readonly measures: string;
  readonly dpoContact: string;
}

/** True when the Art. 33(3) pack carries every required field. */
export function breachPackComplete(pack: BreachPack): boolean {
  if (pack.nature.trim().length === 0) return false;
  if (pack.categories.length === 0) return false;
  if (!Number.isInteger(pack.approximateSubjects) || pack.approximateSubjects < 0) return false;
  if (pack.consequences.trim().length === 0) return false;
  if (pack.measures.trim().length === 0) return false;
  if (pack.dpoContact.trim().length === 0) return false;
  return true;
}
