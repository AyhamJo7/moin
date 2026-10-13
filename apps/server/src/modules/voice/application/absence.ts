/**
 * Traffic-absence alarm (P11.18, R-10).
 *
 * A tenant with an active number that suddenly goes quiet usually means the
 * forwarding broke, not that callers stopped. The alarm fires when zero
 * calls arrive across consecutive expected-busy hours (default 2) — SEV2
 * plus the owner notification "Weiterleitung prüfen". Expected-busy comes
 * from the P01 baseline, then the first 14 days; the baseline itself rides
 * separately, this module owns the silence check.
 */

export const ABSENCE_ALARM_METRIC = 'voice.absence.alarm' as const;
/** Consecutive expected-busy hours of silence before the alarm (P11.18.02). */
export const ABSENCE_CONSECUTIVE_HOURS = 2;
export const ABSENCE_OWNER_MESSAGE = 'Weiterleitung prüfen' as const;

export interface HourlyWindow {
  readonly hourStartMs: number;
  readonly expectedBusy: boolean;
  readonly calls: number;
}

/**
 * True when the trailing windows contain ≥ N consecutive expected-busy
 * hours with zero calls. Windows arrive oldest-first; only the trailing
 * run counts — a busy hour with calls resets the streak.
 */
export function absenceAlarms(
  windows: readonly HourlyWindow[],
  consecutive: number = ABSENCE_CONSECUTIVE_HOURS,
): boolean {
  let silent = 0;
  for (const w of windows) {
    if (w.expectedBusy && w.calls === 0) {
      silent += 1;
      if (silent >= consecutive) return true;
    } else if (w.calls > 0) {
      silent = 0;
    }
  }
  return false;
}
