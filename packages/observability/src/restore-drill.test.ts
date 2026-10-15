/**
 * Restore drill (P17.06): completes + signoff-recorded.
 */
import { describe, expect, it } from 'vitest';
import { drillCompletes, signoffRecorded } from './restore-drill.ts';

const CHECKS = ['smoke', 'isolation', 'deletion-replay', 'outbox'] as const;

describe('restore drill', () => {
  it('completes with every check and sign-off', () => {
    expect(
      drillCompletes({ restorePointDaysAgo: 7, checksPassed: [...CHECKS], signedOff: true }),
    ).toBe(true);
    expect(
      drillCompletes({ restorePointDaysAgo: 7, checksPassed: ['smoke'], signedOff: true }),
    ).toBe(false);
    expect(
      drillCompletes({ restorePointDaysAgo: 40, checksPassed: [...CHECKS], signedOff: true }),
    ).toBe(false);
    expect(
      drillCompletes({ restorePointDaysAgo: 7, checksPassed: [...CHECKS], signedOff: false }),
    ).toBe(false);
  });

  it('records the sign-off', () => {
    expect(signoffRecorded('founder', '2026-10-15', true)).toBe(true);
    expect(signoffRecorded('', '2026-10-15', true)).toBe(false);
    expect(signoffRecorded('founder', 'nope', true)).toBe(false);
    expect(signoffRecorded('founder', '2026-10-15', false)).toBe(false);
  });
});
