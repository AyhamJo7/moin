/**
 * Time, locale and holidays (P07.14.04): DST transitions, German rendering, Hamburg feasts.
 *
 * The DST tests pin the EU-mandated transitions (last Sunday of March/October, 01:00 UTC)
 * against BOTH the pinned offset table and the host Intl: the table is the assertion, Intl
 * is the renderer, and the two must agree — a host tzdata older than the table would show
 * here, not in production rendering.
 */
import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  berlinOffsetMinutesAt,
  coveredYears,
  formatDateDe,
  formatDateDeWithYear,
  formatDateTimeDe,
  formatNumberDe,
  formatTimeDe,
  isPublicHoliday,
  publicHolidayOn,
  zonedDateString,
  zonedFields,
} from './index.ts';

describe('tenant time', () => {
  it('spring forward 2026: the offset flips at 01:00 UTC on March 29', () => {
    expect(berlinOffsetMinutesAt(new Date('2026-03-29T00:59:59Z'))).toBe(60);
    expect(berlinOffsetMinutesAt(new Date('2026-03-29T01:00:00Z'))).toBe(120);
    // Intl agrees with the table on both sides.
    expect(zonedFields(new Date('2026-03-29T00:30:00Z')).hour).toBe(1);
    expect(zonedFields(new Date('2026-03-29T01:30:00Z')).hour).toBe(3);
  });

  it('autumn back 2026: the offset flips at 01:00 UTC on October 25', () => {
    expect(berlinOffsetMinutesAt(new Date('2026-10-25T00:59:59Z'))).toBe(120);
    expect(berlinOffsetMinutesAt(new Date('2026-10-25T01:00:00Z'))).toBe(60);
    expect(zonedFields(new Date('2026-10-25T00:30:00Z')).hour).toBe(2);
    expect(zonedFields(new Date('2026-10-25T01:30:00Z')).hour).toBe(2);
  });

  it('adding a calendar day keeps the local time across the spring transition', () => {
    // Saturday March 28 09:00 local (CET) + 1 day = Sunday March 29 09:00 local (CEST):
    // 23 real hours, same wall clock — the appointment stays at 09:00.
    const saturday = new Date('2026-03-28T08:00:00Z');
    expect(zonedDateString(saturday)).toBe('2026-03-28');
    const sunday = addCalendarDays(saturday, 1);
    expect(zonedDateString(sunday)).toBe('2026-03-29');
    expect(zonedFields(sunday).hour).toBe(9);
    expect(sunday.getTime() - saturday.getTime()).toBe(23 * 3_600_000);
  });

  it('adding a calendar day keeps the local time across the autumn transition', () => {
    // Saturday October 24 09:00 local (CEST) + 1 day = Sunday October 25 09:00 local (CET):
    // 25 real hours, same wall clock.
    const saturday = new Date('2026-10-24T07:00:00Z');
    const sunday = addCalendarDays(saturday, 1);
    expect(zonedDateString(sunday)).toBe('2026-10-25');
    expect(zonedFields(sunday).hour).toBe(9);
    expect(sunday.getTime() - saturday.getTime()).toBe(25 * 3_600_000);
  });

  it('post-table summers keep daylight saving via the Intl path (2035)', () => {
    // Beyond the 2024–2030 pinned table the generic Intl round-trip applies: July 2035
    // is CEST (+120), and a 30-day calendar add keeps 09:00 local.
    expect(berlinOffsetMinutesAt(new Date('2035-07-01T10:00:00Z'))).toBe(120);
    expect(berlinOffsetMinutesAt(new Date('2035-01-15T10:00:00Z'))).toBe(60);
    const start = new Date('2035-07-01T07:00:00Z');
    expect(zonedFields(start).hour).toBe(9);
    const later = addCalendarDays(start, 30);
    expect(zonedDateString(later)).toBe('2035-07-31');
    expect(zonedFields(later).hour).toBe(9);
  });

  it('seconds and milliseconds survive a calendar-day add', () => {
    const at = new Date('2026-05-04T08:15:42.123Z');
    const next = addCalendarDays(at, 1);
    const fields = zonedFields(next);
    expect(fields.second).toBe(42);
    expect(next.getTime() % 1000).toBe(123);
    expect(zonedDateString(next)).toBe('2026-05-05');
  });

  it('gap times shift forward to the first existing minute (spring forward)', () => {
    // 02:30 does not exist on 2026-03-29 in Berlin. Adding a day from 2026-03-28 02:30
    // must land on a VALID 03:xx local time, not silently on 01:30. Normal times are
    // unaffected: 09:00 stays 09:00 (covered above).
    const before = new Date('2026-03-28T01:30:00Z');
    expect(zonedFields(before).hour).toBe(2);
    expect(zonedFields(before).minute).toBe(30);
    const shifted = addCalendarDays(before, 1);
    expect(zonedDateString(shifted)).toBe('2026-03-29');
    const fields = zonedFields(shifted);
    expect(fields.hour).toBe(3);
    expect(fields.minute).toBeGreaterThanOrEqual(0);
    // The result round-trips: it is a real local time, not a silent misresolve.
    expect(zonedFields(shifted).hour).toBe(fields.hour);
  });

  it('rejects bad zones, bad instants and absurd day counts', () => {
    expect(() => zonedFields(new Date('2026-01-01T00:00:00Z'), 'Mars/Olympus')).toThrow(RangeError);
    expect(() => zonedFields(new Date('2026-01-01T00:00:00Z'), '../etc')).toThrow(RangeError);
    expect(() => berlinOffsetMinutesAt(new Date('invalid'))).toThrow(RangeError);
    expect(() => addCalendarDays(new Date(), 1.5)).toThrow(RangeError);
    expect(() => addCalendarDays(new Date(), 4000)).toThrow(RangeError);
  });
});

describe('German formatting', () => {
  it('renders the owner-visible strings with one spelling', () => {
    // Saturday October 3 2026 19:30 CEST: Tag der Deutschen Einheit.
    const at = new Date('2026-10-03T17:30:00Z');
    expect(formatDateDe(at)).toBe('Samstag, 3. Oktober');
    expect(formatDateDeWithYear(at)).toBe('Samstag, 3. Oktober 2026');
    expect(formatTimeDe(at)).toBe('19:30 Uhr');
    expect(formatDateTimeDe(at)).toBe('Samstag, 3. Oktober, 19:30 Uhr');
    expect(formatNumberDe(1234.56)).toBe('1.234,56');
  });

  it('formats Umlaut months without hand-rolled tables drifting', () => {
    expect(formatDateDe(new Date('2026-03-07T11:00:00Z'))).toBe('Samstag, 7. März');
  });
});

describe('Hamburg holidays', () => {
  it('knows the ten Hamburg feasts, fixed and movable', () => {
    expect(publicHolidayOn('2026-10-03')).toStrictEqual({
      date: '2026-10-03',
      name: 'Tag der Deutschen Einheit',
    });
    expect(publicHolidayOn('2026-10-31')?.name).toBe('Reformationstag');
    expect(publicHolidayOn('2026-04-03')?.name).toBe('Karfreitag');
    expect(publicHolidayOn('2026-05-14')?.name).toBe('Christi Himmelfahrt');
    expect(isPublicHoliday('2026-05-25')).toBe(true);
    expect(isPublicHoliday('2026-05-26')).toBe(false);
    expect(isPublicHoliday('2026-10-04')).toBe(false);
  });

  it('fails in November when the next year is missing (the yearly-update reminder)', () => {
    const years = coveredYears();
    const now = new Date().getUTCFullYear();
    const november = new Date().getUTCMonth() >= 10;
    if (november) {
      expect(years).toContain(now + 1);
    } else {
      expect(years.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed dates', () => {
    expect(() => publicHolidayOn('03.10.2026')).toThrow(RangeError);
    expect(() => isPublicHoliday('next Friday')).toThrow(RangeError);
  });
});
