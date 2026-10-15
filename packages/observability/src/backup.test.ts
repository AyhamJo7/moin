/**
 * Backup architecture (P17.05): config-valid + retention-covers.
 */
import { describe, expect, it } from 'vitest';
import {
  backupConfigValid,
  restoreTargetValid,
  BACKUP_RETENTION_DAYS,
  PITR_DAYS,
} from './backup.ts';

const FULL = {
  pitrDays: 35,
  snapshotDaily: true,
  retentionDays: 35,
  crossRegionCopy: true,
} as const;

describe('backup architecture', () => {
  it('validates the backup config', () => {
    expect(PITR_DAYS).toBe(35);
    expect(BACKUP_RETENTION_DAYS).toBe(35);
    expect(backupConfigValid({ ...FULL })).toBe(true);
    expect(backupConfigValid({ ...FULL, retentionDays: 7 })).toBe(false);
    expect(backupConfigValid({ ...FULL, snapshotDaily: false })).toBe(false);
    expect(backupConfigValid({ ...FULL, crossRegionCopy: false })).toBe(false);
  });

  it('covers restore targets within the PITR window', () => {
    expect(restoreTargetValid(0)).toBe(true);
    expect(restoreTargetValid(35)).toBe(true);
    expect(restoreTargetValid(36)).toBe(false);
    expect(restoreTargetValid(-1)).toBe(false);
  });
});
