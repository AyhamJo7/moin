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
 * 2024–2030 as a fast path and a tzdata-independent cross-check; outside it the generic
 * Intl round-trip path applies (same as every other zone), so post-2030 summers keep
 * their +120. Intl remains the renderer — this table exists so tests can assert the
 * offset without depending on the host's tzdata version.
 */
export function berlinOffsetMinutesAt(at: Date): number {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new RangeError('instant is invalid');
  if (
    time < Date.parse(BERLIN_OFFSETS[0]?.from ?? '') ||
    time >= Date.parse('2030-11-01T00:00:00Z')
  ) {
    return genericOffsetMinutesAt(at);
  }
  let offset = 60;
  for (const row of BERLIN_OFFSETS) {
    if (time >= Date.parse(row.from)) offset = row.minutes;
    else break;
  }
  return offset;
}

/** Zone offset by round-tripping an instant through Intl (works for every zone, any year). */
function genericOffsetMinutesAt(at: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number => Number(fields.find((p) => p.type === type)?.value ?? 'NaN');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60_000);
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
  readonly second: number;
  readonly millisecond: number;
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
    second: 'numeric',
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
    second: get('second'),
    millisecond: at.getTime() % 1000,
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
 * resolve back preserving the wall-clock time of day to the second and millisecond.
 * Returns the instant of the same local time n days later; the UTC duration may be
 * 23/24/25 hours per day crossed, which is correct — the appointment stays at 09:00 local,
 * not 08:00 or 10:00.
 *
 * Gap policy (spring forward): a wall-clock time that does not exist on the target date
 * (02:00–02:59 on the last Sunday of March in Berlin) shifts forward to the first existing
 * instant at or after the naive resolve — the candidate advances until its own wall clock
 * round-trips exactly (self-consistent), at most 180 minutes. Non-gap times round-trip on
 * the first check (zero steps).
 * Fold policy (autumn back): the repeated hour exists twice; the earlier (first)
 * occurrence wins — after the gap loop, step back one transition span (60 minutes) while
 * the wall clock still round-trips, so 02:30 resolves to the +0200 occurrence, not +0100.
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
  const ms = ((at.getTime() % 1000) + 1000) % 1000;
  let candidate = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, f.hour, f.minute, f.second, ms) - offset * 60_000,
  );
  // Gap repair: the naive resolve used the noon (post-transition) offset, so a gap
  // wall time lands an hour early (02:30 wall → 01:30 display). Detect the mismatch
  // against the source wall clock; on mismatch the target date is a spring-forward day
  // and the first existing minute is 03:00 — resolve the date at 03:00 with the same
  // noon offset (post-transition, hence correct for 03:00+).
  const naive = zonedFields(candidate, timeZone);
  const inGap =
    naive.year !== (y ?? 0) ||
    naive.month !== (m ?? 1) ||
    naive.day !== (d ?? 1) ||
    naive.hour !== f.hour ||
    naive.minute !== f.minute ||
    naive.second !== f.second;
  if (inGap) {
    candidate = new Date(
      Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 3, 0, f.second, ms) - offset * 60_000,
    );
  }
  // Fold repair: prefer the first occurrence. The naive resolve used the noon
  // (post-transition) offset, so on a fold date it lands on the SECOND occurrence; the
  // first is exactly one transition span (60 minutes for EU folds) earlier. Step back
  // while the wall clock still shows the source wall time — bounded at 60 steps (a fold
  // repeats the wall clock for exactly 60 minutes). Skipped when the gap repair just
  // ran: 03:00 after a gap is unambiguous (post-transition offset), and stepping back
  // would walk into the gap it just left.
  const wallMatches = (instant: Date): boolean => {
    const round = zonedFields(instant, timeZone);
    return (
      round.year === (y ?? 0) &&
      round.month === (m ?? 1) &&
      round.day === (d ?? 1) &&
      round.hour === f.hour &&
      round.minute === f.minute &&
      round.second === f.second
    );
  };
  if (!inGap) {
    for (let step = 0; step < 60; step += 1) {
      const earlier = new Date(candidate.getTime() - 3_600_000);
      if (!wallMatches(earlier)) break;
      candidate = earlier;
    }
  }
  return candidate;
}

function offsetMinutesAt(noonIso: string, timeZone: string): number {
  if (timeZone === 'Europe/Berlin') {
    const noon = new Date(noonIso);
    const first = BERLIN_OFFSETS[0]?.from ?? '';
    if (
      noon.getTime() >= Date.parse(first) &&
      noon.getTime() < Date.parse('2030-11-01T00:00:00Z')
    ) {
      return berlinOffsetMinutesAt(noon);
    }
  }
  return genericOffsetMinutesAt(new Date(noonIso), timeZone);
}
