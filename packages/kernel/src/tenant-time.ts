/**
 * Tenant time (P07.14.01): the clock plus the tenant time zone, DST-safe by construction.
 *
 * Storage is always UTC (`timestamptz`); business logic renders and computes in the tenant
 * zone (`locations.time_zone`, `Europe/Berlin` default). All arithmetic here happens on the
 * UTC instant — adding "24 hours" to an instant is always exactly 24 hours, even across a
 * DST transition — and only the RENDERING resolves the zone. That is the whole DST-safety
 * argument: a "day" in wall-clock terms is 23/24/25 hours long twice a year, but an instant
 * plus a duration never is. DST bugs come from adding days to wall-clock fields; this module
 * never does.
 */

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

/** IANA zone shape check: letters, digits, `_`, `+`, `-`, `/` — enough for real zones, nothing for injection into log lines. */
const TIME_ZONE_RE = /^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/u;

export function checkTimeZone(zone: string): string {
  if (!TIME_ZONE_RE.test(zone) || zone.length > 64) {
    throw new RangeError('time zone must be an IANA area/location name');
  }
  // The zone must actually exist: a well-formed but unknown name would fail late inside
  // Intl with a confusing error. Resolving it here fails fast at the boundary.
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: zone });
  } catch {
    throw new RangeError('unknown time zone');
  }
  return zone;
}

const BERLIN_OFFSETS: readonly { readonly from: string; readonly minutes: number }[] = [
  { from: '2024-03-31T01:00:00Z', minutes: 120 },
  { from: '2024-10-27T01:00:00Z', minutes: 60 },
  { from: '2025-03-30T01:00:00Z', minutes: 120 },
  { from: '2025-10-26T01:00:00Z', minutes: 60 },
  { from: '2026-03-29T01:00:00Z', minutes: 120 },
  { from: '2026-10-25T01:00:00Z', minutes: 60 },
  { from: '2027-03-28T01:00:00Z', minutes: 120 },
  { from: '2027-10-31T01:00:00Z', minutes: 60 },
  { from: '2028-03-26T01:00:00Z', minutes: 120 },
  { from: '2028-10-29T01:00:00Z', minutes: 60 },
  { from: '2029-03-25T01:00:00Z', minutes: 120 },
  { from: '2029-10-28T01:00:00Z', minutes: 60 },
  { from: '2030-03-31T01:00:00Z', minutes: 120 },
  { from: '2030-10-27T01:00:00Z', minutes: 60 },
];

/**
 * Offset of Europe/Berlin east of UTC in minutes at the given instant, from a table of the
 * EU-mandated transitions (last Sunday of March/October, 01:00 UTC). The table covers
 * 2024–2030; outside it the standard-time offset (+60) applies, and extending the table is
 * a data change, not a logic change. Intl remains the renderer — this table exists so tests
 * can assert the offset without depending on the host's tzdata version.
 */
export function berlinOffsetMinutesAt(at: Date): number {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new RangeError('instant is invalid');
  let offset = 60;
  for (const row of BERLIN_OFFSETS) {
    if (time >= Date.parse(row.from)) offset = row.minutes;
    else break;
  }
  return offset;
}

/**
 * Wall-clock fields of an instant in the given zone, via Intl (the host's tzdata does the
 * DST lookup; `berlinOffsetMinutesAt` is the pinned cross-check, not the renderer).
 */
export function zonedFields(
  at: Date,
  timeZone = DEFAULT_TIME_ZONE,
): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
} {
  checkTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type)?.value ?? '';
    // German short weekday names in fixed order (So/Mo/Di/Mi/Do/Fr/Sa → 0..6, Sunday-first).
    if (type === 'weekday') {
      const order = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      const index = order.indexOf(found.slice(0, 2));
      if (index < 0) throw new Error('unexpected weekday from Intl');
      return index;
    }
    const n = Number(found);
    if (!Number.isFinite(n)) throw new Error(`unexpected ${type} from Intl`);
    return n;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    weekday: get('weekday'),
  };
}

/** The calendar date (YYYY-MM-DD) of an instant in the given zone. */
export function zonedDateString(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const f = zonedFields(at, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(f.year).padStart(4, '0')}-${pad(f.month)}-${pad(f.day)}`;
}

/**
 * Add whole calendar days in the tenant zone: resolve to the zone's wall clock, add the day
 * count to the DATE (not 24h × n to the instant — that drifts across a transition), then
 * resolve back preserving the wall-clock time of day. Returns the instant of the same local
 * time n days later; the UTC duration may be 23/24/25 hours per day crossed, which is
 * correct — the appointment stays at 09:00 local, not 08:00 or 10:00.
 */
export function addCalendarDays(at: Date, days: number, timeZone = DEFAULT_TIME_ZONE): Date {
  if (!Number.isInteger(days) || Math.abs(days) > 3660) {
    throw new RangeError('days must be a whole number within ±3660');
  }
  checkTimeZone(timeZone);
  const f = zonedFields(at, timeZone);
  // Noon UTC anchor avoids the transition hour itself: the date arithmetic below works on
  // the calendar date, and resolving at noon local can never land in the missing 02:00–03:00
  // hour (spring forward) or ambiguously in the repeated one (autumn back).
  const utcNoon = Date.UTC(f.year, f.month - 1, f.day, 12, 0, 0);
  const shifted = new Date(utcNoon + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
  const [y, m, d] = parts.split('-').map(Number);
  // Resolve the target date at the ORIGINAL wall-clock time, via the zone offset at noon
  // on that date (midday is never inside a transition).
  const noonTarget = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).toISOString();
  const offset = offsetMinutesAt(noonTarget, timeZone);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, f.hour, f.minute, 0) - offset * 60_000);
}

function offsetMinutesAt(noonIso: string, timeZone: string): number {
  if (timeZone === 'Europe/Berlin') return berlinOffsetMinutesAt(new Date(noonIso));
  // Generic zones: derive from Intl by round-tripping noon UTC through the zone.
  const noon = new Date(noonIso);
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(noon);
  const get = (type: string): number => Number(fields.find((p) => p.type === type)?.value ?? 'NaN');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - noon.getTime()) / 60_000);
}
