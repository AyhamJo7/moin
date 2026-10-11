/**
 * German formatting (P07.14.03): dates, times, numbers — owner-visible strings, one spelling.
 *
 * Berlin-only like the tenant-time module it renders: the timeZone parameter exists so
 * call sites name the zone explicitly, but only Europe/Berlin is accepted (checkTimeZone
 * gates it). "Samstag, 3. Oktober", "19:30 Uhr" — built on Intl `de-DE`, never hand-rolled
 * month tables (a hand-rolled table is how "Oktober" becomes "October" in exactly one code
 * path). Times always carry the "Uhr" suffix the voice scripts and owner app share; numbers
 * use the German decimal comma via the existing `Money.formatDe` precedent.
 */

import { checkTimeZone, DEFAULT_TIME_ZONE, zonedFields } from './tenant-time.ts';

const WEEKDAYS_DE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
] as const;

const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "Samstag, 3. Oktober" — weekday, day, month; the year is spoken only when asked for. */
export function formatDateDe(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  checkTimeZone(timeZone);
  const f = zonedFields(at, timeZone);
  const weekday = WEEKDAYS_DE[f.weekday] ?? '';
  const month = MONTHS_DE[f.month - 1] ?? '';
  if (weekday === '' || month === '') throw new Error('unexpected date fields from Intl');
  return `${weekday}, ${String(f.day)}. ${month}`;
}

/** "Samstag, 3. Oktober 2026" — with the year for confirmations and records. */
export function formatDateDeWithYear(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return `${formatDateDe(at, timeZone)} ${String(zonedFields(at, checkTimeZone(timeZone)).year)}`;
}

/** "19:30 Uhr" — 24-hour clock with the shared suffix. */
export function formatTimeDe(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  checkTimeZone(timeZone);
  const f = zonedFields(at, timeZone);
  return `${pad2(f.hour)}:${pad2(f.minute)} Uhr`;
}

/** "Samstag, 3. Oktober, 19:30 Uhr" — the appointment rendering the voice scripts read. */
export function formatDateTimeDe(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return `${formatDateDe(at, timeZone)}, ${formatTimeDe(at, timeZone)}`;
}

/** "1.234,56" — German decimal comma and thousands point. */
export function formatNumberDe(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('number must be finite');
  return new Intl.NumberFormat('de-DE').format(value);
}
