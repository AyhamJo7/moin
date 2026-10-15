/**
 * Traffic-absence alarm (P11.18.02/.03, R-10): silence across expected-busy
 * hours fires; active lines stay quiet; off-hours silence is normal.
 */
import { describe, expect, it } from 'vitest';
import {
  absenceAlarms,
  ABSENCE_ALARM_METRIC,
  ABSENCE_CONSECUTIVE_HOURS,
  ABSENCE_OWNER_MESSAGE,
} from './absence.ts';

function window(hour: number, expectedBusy: boolean, calls: number) {
  return { hourStartMs: hour * 3_600_000, expectedBusy, calls };
}

describe('traffic-absence alarm', () => {
  it('fires on 2 consecutive expected-busy silent hours (R-10 drill shape)', () => {
    expect(ABSENCE_CONSECUTIVE_HOURS).toBe(2);
    expect(ABSENCE_ALARM_METRIC).toBe('voice.absence.alarm');
    expect(ABSENCE_OWNER_MESSAGE).toBe('Weiterleitung prüfen');
    expect(absenceAlarms([window(9, true, 3), window(10, true, 0), window(11, true, 0)])).toBe(
      true,
    );
  });

  it('stays quiet on active lines and off-hours silence', () => {
    expect(absenceAlarms([window(9, true, 2), window(10, true, 1), window(11, true, 4)])).toBe(
      false,
    );
    // Off-hours silence is normal, even many hours of it.
    expect(absenceAlarms([window(0, false, 0), window(1, false, 0), window(2, false, 0)])).toBe(
      false,
    );
    // One silent busy hour is not enough; a call resets the streak.
    expect(absenceAlarms([window(9, true, 0)])).toBe(false);
    expect(absenceAlarms([window(9, true, 0), window(10, true, 2), window(11, true, 0)])).toBe(
      false,
    );
  });
});
