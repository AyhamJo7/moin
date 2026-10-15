/**
 * Backup architecture (P17.05.01, engineering shapes only): PITR window +
 * snapshot schedule + retention + restore-target shapes (no live calls).
 * Erased data provably disappears from backups within 35 days (P17.05.01);
 * longer retention needs EXT-02 approval. Real vaults and jobs stay
 * founder-driven.
 */

/** PITR window in days (P17.05.01). */
export const PITR_DAYS = 35;

/** Backup retention in days — aligned with PITR (P17.05.01). */
export const BACKUP_RETENTION_DAYS = 35;

export interface BackupConfig {
  readonly pitrDays: number;
  readonly snapshotDaily: boolean;
  readonly retentionDays: number;
  readonly crossRegionCopy: boolean;
}

/** True when the config meets the architecture: 35d PITR + daily + 35d. */
export function backupConfigValid(config: BackupConfig): boolean {
  return (
    config.pitrDays === PITR_DAYS &&
    config.snapshotDaily &&
    config.retentionDays === BACKUP_RETENTION_DAYS &&
    config.crossRegionCopy
  );
}

/** Restore target: point-in-time within the PITR window. */
export function restoreTargetValid(restorePointDaysAgo: number): boolean {
  if (!Number.isFinite(restorePointDaysAgo) || restorePointDaysAgo < 0) return false;
  return restorePointDaysAgo <= PITR_DAYS;
}
