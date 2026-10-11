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
import {
  addCalendarDays,
  berlinOffsetMinutesAt,
  publicHolidayOn,
  zonedDateString,
  zonedFields,
} from '@moin/kernel';
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
 * Exceptions override weekly on the spill leg too: when yesterday has ANY exception
 * row, its weekly midnight-spanning rules do NOT spill — only yesterday's own
 * overnight exception hours spill. (A Friday closure must kill the weekly Friday
 * 22:00–02:00 Saturday leg; only a Friday overnight exception re-opens it.)
 */
export function hoursOnDate(
  date: string,
  weekday: number,
  snapshot: HoursSnapshot,
  yesterdayWeekday: number,
  yesterdayDate: string | null = null,
): DayHours {
  // Yesterday's midnight-spanning legs FIRST: they cover 00:00–close today whatever
  // today holds (even when today has its own exception — the spill-over already
  // started last night and cannot be un-started). When yesterday carries ANY
  // exception row, weekly spill is SUPPRESSED — only yesterday's own overnight
  // exception hours spill (exceptions override weekly, on the spill leg too).
  const spill: OpeningInterval[] = [];
  const yesterdayException =
    yesterdayDate === null ? null : exceptionOn(yesterdayDate, snapshot.exceptions);
  if (yesterdayException === null) {
    for (const r of snapshot.rules) {
      if (r.weekday === yesterdayWeekday) {
        const split = splitInterval(r.opens_min, r.closes_min);
        if (split.tomorrow !== null) spill.push(split.tomorrow);
      }
    }
  } else {
    const opens = yesterdayException.opens_min;
    const closes = yesterdayException.closes_min;
    if (opens !== null && closes !== null && opens > closes) {
      spill.push({ opensMin: 0, closesMin: closes });
    }
  }
  const exception = exceptionOn(date, snapshot.exceptions);
  if (exception !== null) {
    if (exception.opens_min === null || exception.closes_min === null) {
      // Closed-all-day exception — but yesterday's spill still covers 00:00–close.
      if (spill.length > 0) {
        return { date, intervals: spill, closed: false, reason: exception.label ?? exception.kind };
      }
      return { date, intervals: [], closed: true, reason: exception.label ?? exception.kind };
    }
    const split = splitInterval(exception.opens_min, exception.closes_min);
    const intervals = split.today === null ? [] : [split.today];
    intervals.push(...spill);
    intervals.sort((a, b) => a.opensMin - b.opensMin);
    return {
      date,
      intervals,
      closed: intervals.length === 0,
      reason: exception.label ?? exception.kind,
    };
  }
  const intervals: OpeningInterval[] = [...spill];
  for (const r of snapshot.rules) {
    if (r.weekday === weekday) {
      const split = splitInterval(r.opens_min, r.closes_min);
      if (split.today !== null) intervals.push(split.today);
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
  const yesterdayInstant = addCalendarDays(at, -1);
  const yesterday = zonedFields(yesterdayInstant);
  const day = hoursOnDate(
    date,
    fields.weekday,
    snapshot,
    yesterday.weekday,
    zonedDateString(yesterdayInstant),
  );
  if (day.closed) return false;
  const now = minutesOf(fields);
  return day.intervals.some((i) => i.opensMin <= now && now < i.closesMin);
}

/**
 * First opening at or after the given instant: scans day by day (cap 366 — a
 * location closed a full year has no next opening worth naming). Returns the
 * instant of the opening minute, or null when nothing opens within the cap.
 * Wall-clock resolved (never minute arithmetic): the opening instant is built from
 * the target DATE at the opening wall time through the zone offset — elapsed-ms
 * math on wall minutes breaks across DST (spring 00:30→09:00 would land 10:00).
 */
export function nextOpening(after: Date, snapshot: HoursSnapshot): Date | null {
  const fields = zonedFields(after);
  for (let d = 0; d < 366; d++) {
    const probe = addCalendarDays(after, d);
    const pf = zonedFields(probe);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = `${String(pf.year).padStart(4, '0')}-${pad(pf.month)}-${pad(pf.day)}`;
    const yesterdayInstant = addCalendarDays(probe, -1);
    const yesterday = zonedFields(yesterdayInstant);
    const day = hoursOnDate(
      date,
      pf.weekday,
      snapshot,
      yesterday.weekday,
      zonedDateString(yesterdayInstant),
    );
    const startMin = d === 0 ? minutesOf(fields) : 0;
    for (const interval of day.intervals) {
      if (interval.closesMin > startMin) {
        const openMin = Math.max(interval.opensMin, startMin);
        return wallMinutesOnDate(date, openMin);
      }
    }
  }
  return null;
}

/**
 * Resolve a calendar date + wall-clock minutes to the instant in Europe/Berlin:
 * noon-offset resolve (midday is never inside a transition) + gap shift-forward to
 * 03:00 + fold first-occurrence — the kernel addCalendarDays policy, factored for a
 * caller-chosen wall time instead of the source instant's. Returns null only when
 * the wall time falls inside the spring gap AND equals the gap repair itself
 * (unreachable: gap repair lands 03:00 exactly).
 */
function wallMinutesOnDate(date: string, minutes: number): Date | null {
  const [y, m, d] = date.split('-').map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const noonTarget = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).toISOString();
  const offset = berlinOffsetMinutesAt(new Date(noonTarget));
  let candidate = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0) - offset * 60_000,
  );
  const naive = zonedFields(candidate);
  const matches =
    naive.year === (y ?? 0) &&
    naive.month === (m ?? 1) &&
    naive.day === (d ?? 1) &&
    naive.hour === hour &&
    naive.minute === minute;
  if (!matches) {
    // Spring gap: the wall time does not exist — shift to the first existing minute.
    // A 02:xx opening on a forward day resolves to 03:00 (same date, never skipped).
    if (hour === 2) {
      candidate = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 3, 0, 0, 0) - offset * 60_000);
      return candidate;
    }
    return null;
  }
  // Fold: prefer the first occurrence — step back one transition span (60 min) while
  // the wall clock still shows the target time.
  let stepped = candidate;
  for (let i = 0; i < 60; i++) {
    const earlier = new Date(stepped.getTime() - 60_000);
    const round = zonedFields(earlier);
    if (
      round.year !== (y ?? 0) ||
      round.month !== (m ?? 1) ||
      round.day !== (d ?? 1) ||
      round.hour !== hour ||
      round.minute !== minute
    ) {
      break;
    }
    stepped = earlier;
  }
  return stepped;
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
    const yesterdayInstant = addCalendarDays(day, -1);
    const yesterday = zonedFields(yesterdayInstant);
    // Weekday for hoursOnDate is Sunday-first; Monday+i maps to (i+1)%7.
    const hours = hoursOnDate(
      date,
      (i + 1) % 7,
      snapshot,
      yesterday.weekday,
      zonedDateString(yesterdayInstant),
    );
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
