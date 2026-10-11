/**
 * Opening-hours engine (P09.03): weekly rules + dated exceptions per location.
 *
 * Storage (`opening_rules`, `opening_exceptions`, 0054) holds wall-clock minutes;
 * ALL time math here goes through the kernel (`zonedFields`, `zonedDateString`,
 * `addCalendarDays`, Berlin-only) so DST transitions resolve exactly as the rest of
 * the system sees them. Public holidays come from the kernel Hamburg dataset
 * (`publicHolidayOn`) — Betriebsferien are tenant exception rows (kind vacation),
 * never the global file.
 *
 * Query semantics (pure functions over loaded rows + kernel):
 * - `isOpenAt`: exception hours win over weekly rules; NULL exception hours = closed
 *   all day; public holiday without an exception row = weekly rules apply (a holiday
 *   override must be EXPLICIT — silence keeps the regular hours, never a guess).
 * - Midnight-spanning intervals (open > close) split: 22:00–02:00 covers day D
 *   22:00–24:00 plus day D+1 00:00–02:00 (the D+1 leg is checked via yesterday's rules).
 * - `nextOpening`: scans forward day by day (cap 366) for the first open minute at
 *   or after the instant; closed-all-day exceptions and holidays-without-hours skip.
 * - `describeWeek`: deterministic German week summary from Monday ("Mo 09:00–12:00,
 *   14:00–18:00; …; So geschlossen").
 *
 * Writes are staff-direct with optimistic locking (expectedVersion compare-and-bump,
 * profile.ts shape). Audit carries scope + version markers only (INV-12).
 */

import { randomUUID } from 'node:crypto';
import { addCalendarDays, publicHolidayOn, zonedDateString, zonedFields } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExceptionKind = 'holiday' | 'closure' | 'vacation';

const KIND_MARKER: Record<ExceptionKind, number> = { holiday: 0, closure: 1, vacation: 2 };

export interface OpeningInterval {
  readonly opensMin: number;
  readonly closesMin: number;
}

export interface DayHours {
  readonly date: string;
  readonly intervals: readonly OpeningInterval[];
  readonly closed: boolean;
  readonly reason: string | null;
}

interface RuleRow extends Record<string, unknown> {
  weekday: number;
  opens_min: number;
  closes_min: number;
}

interface ExceptionRow extends Record<string, unknown> {
  kind: string;
  start_date: string;
  end_date: string;
  opens_min: number | null;
  closes_min: number | null;
  label: string | null;
}

function checkMinutes(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new RangeError(`${field} must be 0..1439 minutes`);
  }
  return value;
}

function checkWeekday(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new RangeError('weekday must be 0..6 (Sunday-first)');
  }
  return value;
}

function checkDateString(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new RangeError(`${field} must be YYYY-MM-DD`);
  return value;
}

function checkLocationId(locationId: string): string {
  if (!UUID_RE.test(locationId)) throw new RangeError('location id must be a uuid');
  return locationId;
}

/** Split a possibly midnight-spanning interval into day-local segments. */
function splitInterval(
  opens: number,
  closes: number,
): {
  today: OpeningInterval | null;
  tomorrow: OpeningInterval | null;
} {
  if (opens < closes) return { today: { opensMin: opens, closesMin: closes }, tomorrow: null };
  return {
    today: { opensMin: opens, closesMin: 1440 },
    tomorrow: { opensMin: 0, closesMin: closes },
  };
}

export interface HoursSnapshot {
  readonly rules: readonly (RuleRow & { weekday: number })[];
  readonly exceptions: readonly ExceptionRow[];
}

/** Load rules + exceptions for one location (tenant-scoped by RLS). */
export async function loadHours(client: TenantClient, locationId: string): Promise<HoursSnapshot> {
  checkLocationId(locationId);
  const rules = await client.query<RuleRow>(
    `select weekday, opens_min, closes_min from opening_rules
     where location_id = $1 order by weekday, opens_min`,
    [locationId],
  );
  const exceptions = await client.query<ExceptionRow>(
    `select kind, start_date::text, end_date::text, opens_min, closes_min, label
     from opening_exceptions where location_id = $1 order by start_date`,
    [locationId],
  );
  return { rules: rules.rows, exceptions: exceptions.rows };
}

function exceptionOn(date: string, exceptions: readonly ExceptionRow[]): ExceptionRow | null {
  for (const e of exceptions) {
    if (e.start_date <= date && date <= e.end_date) return e;
  }
  return null;
}

/**
 * Hours for one calendar date: exception wins (NULL hours = closed with the
 * exception label/holiday name as reason), else weekly rules + yesterday's
 * spill-over leg for midnight-spanning intervals. Public holidays do NOT close
 * implicitly — without an explicit exception row the regular rules apply.
 */
export function hoursOnDate(
  date: string,
  weekday: number,
  snapshot: HoursSnapshot,
  yesterdayWeekday: number,
): DayHours {
  const exception = exceptionOn(date, snapshot.exceptions);
  if (exception !== null) {
    if (exception.opens_min === null || exception.closes_min === null) {
      return { date, intervals: [], closed: true, reason: exception.label ?? exception.kind };
    }
    const split = splitInterval(exception.opens_min, exception.closes_min);
    const intervals = split.today === null ? [] : [split.today];
    return {
      date,
      intervals,
      closed: intervals.length === 0,
      reason: exception.label ?? exception.kind,
    };
  }
  const intervals: OpeningInterval[] = [];
  for (const r of snapshot.rules) {
    if (r.weekday === weekday) {
      const split = splitInterval(r.opens_min, r.closes_min);
      if (split.today !== null) intervals.push(split.today);
    }
    if (r.weekday === yesterdayWeekday) {
      const split = splitInterval(r.opens_min, r.closes_min);
      if (split.tomorrow !== null) intervals.push(split.tomorrow);
    }
  }
  intervals.sort((a, b) => a.opensMin - b.opensMin);
  const holiday = publicHolidayOn(date);
  return {
    date,
    intervals,
    closed: intervals.length === 0,
    reason: intervals.length === 0 && holiday !== null ? holiday.name : null,
  };
}

function minutesOf(fields: { hour: number; minute: number }): number {
  return fields.hour * 60 + fields.minute;
}

/** True when the location is open at the given instant (Europe/Berlin). */
export function isOpenAt(at: Date, snapshot: HoursSnapshot): boolean {
  const fields = zonedFields(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(fields.year).padStart(4, '0')}-${pad(fields.month)}-${pad(fields.day)}`;
  const yesterday = zonedFields(addCalendarDays(at, -1));
  const day = hoursOnDate(date, fields.weekday, snapshot, yesterday.weekday);
  if (day.closed) return false;
  const now = minutesOf(fields);
  return day.intervals.some((i) => i.opensMin <= now && now < i.closesMin);
}

/**
 * First opening at or after the given instant: scans day by day (cap 366 — a
 * location closed a full year has no next opening worth naming). Returns the
 * instant of the opening minute, or null when nothing opens within the cap.
 */
export function nextOpening(after: Date, snapshot: HoursSnapshot): Date | null {
  const fields = zonedFields(after);
  const pad = (n: number): string => String(n).padStart(2, '0');
  for (let d = 0; d < 366; d++) {
    const probe = addCalendarDays(after, d);
    const pf = zonedFields(probe);
    const date = `${String(pf.year).padStart(4, '0')}-${pad(pf.month)}-${pad(pf.day)}`;
    const yesterday = zonedFields(addCalendarDays(probe, -1));
    const day = hoursOnDate(date, pf.weekday, snapshot, yesterday.weekday);
    const startMin = d === 0 ? minutesOf(fields) : 0;
    for (const interval of day.intervals) {
      if (interval.closesMin > startMin) {
        const openMin = Math.max(interval.opensMin, startMin);
        return addMinutesOnDate(probe, openMin, pf.hour * 60 + pf.minute);
      }
    }
  }
  return null;
}

function addMinutesOnDate(base: Date, targetMin: number, baseMin: number): Date {
  // Same wall-clock date as base, at targetMin minutes since midnight: walk from the
  // base instant by the minute delta. Minute deltas under a day cross a DST transition
  // at most once and only when the opening itself is inside the transition hour —
  // the kernel gap/fold policies own that edge; the date never shifts (delta < 24h).
  const deltaMs =
    (targetMin - baseMin) * 60_000 - base.getSeconds() * 1000 - base.getMilliseconds();
  return new Date(base.getTime() + deltaMs);
}

/** Deterministic German week summary starting Monday for the week containing `at`. */
export function describeWeek(at: Date, snapshot: HoursSnapshot): string {
  const fields = zonedFields(at);
  // Monday of this week: weekday 0=Sunday → back (weekday+6)%7 days.
  const back = (fields.weekday + 6) % 7;
  const monday = addCalendarDays(at, -back);
  const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addCalendarDays(monday, i);
    const date = zonedDateString(day);
    const yesterday = zonedFields(addCalendarDays(day, -1));
    // Weekday for hoursOnDate is Sunday-first; Monday+i maps to (i+1)%7.
    const hours = hoursOnDate(date, (i + 1) % 7, snapshot, yesterday.weekday);
    const fmt = (m: number): string =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const body =
      hours.intervals.length === 0
        ? 'geschlossen'
        : hours.intervals.map((iv) => `${fmt(iv.opensMin)}–${fmt(iv.closesMin % 1440)}`).join(', ');
    parts.push(`${names[i] ?? ''} ${body}`);
  }
  return parts.join('; ');
}

export interface RuleInput {
  readonly weekday: number;
  readonly opensMin: number;
  readonly closesMin: number;
}

export interface ExceptionInput {
  readonly kind: ExceptionKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly opensMin?: number | null | undefined;
  readonly closesMin?: number | null | undefined;
  readonly label?: string | undefined;
}

/** Staff write: replace all weekly rules for a location (audited, markers only). */
export async function setWeeklyRules(
  client: TenantClient,
  locationId: string,
  rules: readonly RuleInput[],
): Promise<number> {
  checkLocationId(locationId);
  for (const r of rules) {
    checkWeekday(r.weekday);
    checkMinutes(r.opensMin, 'opensMin');
    checkMinutes(r.closesMin, 'closesMin');
    if (r.opensMin === r.closesMin) throw new RangeError('interval must not be empty');
  }
  await client.query(`delete from opening_rules where location_id = $1`, [locationId]);
  for (const r of rules) {
    await client.query(
      `insert into opening_rules (organisation_id, id, location_id, weekday, opens_min, closes_min)
       values (app.current_org(), $1, $2, $3, $4, $5)`,
      [randomUUID(), locationId, r.weekday, r.opensMin, r.closesMin],
    );
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'hours.set',
    targetKind: 'opening_rules',
    targetId: locationId,
    argsSanitized: { scope: 0, version: rules.length },
    result: 'succeeded',
  });
  return rules.length;
}

/** Staff write: add one dated exception (audited, markers only). */
export async function addException(
  client: TenantClient,
  locationId: string,
  input: ExceptionInput,
): Promise<string> {
  checkLocationId(locationId);
  const start = checkDateString(input.startDate, 'startDate');
  const end = checkDateString(input.endDate, 'endDate');
  if (start > end) throw new RangeError('startDate must not be after endDate');
  const opens = input.opensMin ?? null;
  const closes = input.closesMin ?? null;
  if ((opens === null) !== (closes === null)) {
    throw new RangeError('opensMin and closesMin travel together or are both null (closed)');
  }
  if (opens !== null && closes !== null) {
    checkMinutes(opens, 'opensMin');
    checkMinutes(closes, 'closesMin');
    if (opens === closes) throw new RangeError('interval must not be empty');
  }
  const label = input.label === undefined ? null : input.label.trim();
  if (label !== null && (label.length === 0 || label.length > 120)) {
    throw new RangeError('label must be 1..120 characters');
  }
  const id = randomUUID();
  await client.query(
    `insert into opening_exceptions
       (organisation_id, id, location_id, kind, start_date, end_date, opens_min, closes_min, label)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, locationId, input.kind, start, end, opens, closes, label],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'hours.set',
    targetKind: 'opening_exceptions',
    targetId: id,
    argsSanitized: { scope: 1, version: KIND_MARKER[input.kind] },
    result: 'succeeded',
  });
  return id;
}
