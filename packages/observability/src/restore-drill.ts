/**
 * Restore drill (P17.06, engineering shapes only): drill procedure shape —
 * restore target + verify checks + sign-off record. The live drill (staging
 * PITR, RTO/RPO measurement, `restore.md` timings) stays founder-driven.
 */

export type DrillCheck = 'smoke' | 'isolation' | 'deletion-replay' | 'outbox';

export interface DrillRecord {
  readonly restorePointDaysAgo: number;
  readonly checksPassed: readonly DrillCheck[];
  readonly signedOff: boolean;
}

const REQUIRED: readonly DrillCheck[] = ['smoke', 'isolation', 'deletion-replay', 'outbox'];

/** True when the drill completed: every check passed and signed off. */
export function drillCompletes(record: DrillRecord): boolean {
  if (!Number.isFinite(record.restorePointDaysAgo) || record.restorePointDaysAgo < 0) return false;
  if (record.restorePointDaysAgo > 35) return false;
  for (const check of REQUIRED) {
    if (!record.checksPassed.includes(check)) return false;
  }
  return record.signedOff;
}

/** True when the sign-off record is present (drill + signer + date). */
export function signoffRecorded(signer: string, dateIso: string, completed: boolean): boolean {
  if (!completed) return false;
  if (signer.trim().length === 0) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateIso);
}
