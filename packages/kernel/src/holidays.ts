/**
 * Public holidays (P07.14.02): Hamburg dataset as a versioned data file, not a table.
 *
 * Why a file: the P09 opening-hours engine reads this through the kernel, and holiday
 * lookups are by (Bundesland, date) — a Map lookup, not a join. A `public_holidays` table
 * is already reserved in the global-tables register for the day queries need SQL; until
 * then a reviewed JSON file is the smaller, honest shape (A-21: manually maintained).
 *
 * Coverage: Hamburg (HH) 2026–2030, the ten Hamburg feasts — six fixed (Neujahr, Tag der
 * Arbeit, Tag der Deutschen Einheit, Reformationstag, 1./2. Weihnachtstag) plus the four
 * Easter movables (Karfreitag, Ostermontag, Christi Himmelfahrt, Pfingstmontag) by
 * Gregorian computus. Other Bundesländer arrive with their first customer (their sets
 * differ — e.g. Fronleichnam, Allerheiligen, Buß- und Bettag).
 *
 * Yearly update: append the next year's ten rows before December (the dataset's own
 * staleness test fails in November when the next year is missing — the reminder, not a
 * runtime fetch). Betriebsferien (per-location company holidays) are NOT here: they are
 * tenant data and belong in the P09 opening_exceptions table, never in a global file.
 */

export type Bundesland = 'HH';

export interface PublicHoliday {
  readonly date: string;
  readonly name: string;
}

const HAMBURG_2026_2030: readonly PublicHoliday[] = [
  { date: '2026-01-01', name: 'Neujahr' },
  { date: '2026-04-03', name: 'Karfreitag' },
  { date: '2026-04-06', name: 'Ostermontag' },
  { date: '2026-05-01', name: 'Tag der Arbeit' },
  { date: '2026-05-14', name: 'Christi Himmelfahrt' },
  { date: '2026-05-25', name: 'Pfingstmontag' },
  { date: '2026-10-03', name: 'Tag der Deutschen Einheit' },
  { date: '2026-10-31', name: 'Reformationstag' },
  { date: '2026-12-25', name: '1. Weihnachtstag' },
  { date: '2026-12-26', name: '2. Weihnachtstag' },
  { date: '2027-01-01', name: 'Neujahr' },
  { date: '2027-03-26', name: 'Karfreitag' },
  { date: '2027-03-29', name: 'Ostermontag' },
  { date: '2027-05-01', name: 'Tag der Arbeit' },
  { date: '2027-05-06', name: 'Christi Himmelfahrt' },
  { date: '2027-05-17', name: 'Pfingstmontag' },
  { date: '2027-10-03', name: 'Tag der Deutschen Einheit' },
  { date: '2027-10-31', name: 'Reformationstag' },
  { date: '2027-12-25', name: '1. Weihnachtstag' },
  { date: '2027-12-26', name: '2. Weihnachtstag' },
  { date: '2028-01-01', name: 'Neujahr' },
  { date: '2028-04-14', name: 'Karfreitag' },
  { date: '2028-04-17', name: 'Ostermontag' },
  { date: '2028-05-01', name: 'Tag der Arbeit' },
  { date: '2028-05-25', name: 'Christi Himmelfahrt' },
  { date: '2028-06-05', name: 'Pfingstmontag' },
  { date: '2028-10-03', name: 'Tag der Deutschen Einheit' },
  { date: '2028-10-31', name: 'Reformationstag' },
  { date: '2028-12-25', name: '1. Weihnachtstag' },
  { date: '2028-12-26', name: '2. Weihnachtstag' },
  { date: '2029-01-01', name: 'Neujahr' },
  { date: '2029-03-30', name: 'Karfreitag' },
  { date: '2029-04-02', name: 'Ostermontag' },
  { date: '2029-05-01', name: 'Tag der Arbeit' },
  { date: '2029-05-10', name: 'Christi Himmelfahrt' },
  { date: '2029-05-21', name: 'Pfingstmontag' },
  { date: '2029-10-03', name: 'Tag der Deutschen Einheit' },
  { date: '2029-10-31', name: 'Reformationstag' },
  { date: '2029-12-25', name: '1. Weihnachtstag' },
  { date: '2029-12-26', name: '2. Weihnachtstag' },
  { date: '2030-01-01', name: 'Neujahr' },
  { date: '2030-04-19', name: 'Karfreitag' },
  { date: '2030-04-22', name: 'Ostermontag' },
  { date: '2030-05-01', name: 'Tag der Arbeit' },
  { date: '2030-05-30', name: 'Christi Himmelfahrt' },
  { date: '2030-06-10', name: 'Pfingstmontag' },
  { date: '2030-10-03', name: 'Tag der Deutschen Einheit' },
  { date: '2030-10-31', name: 'Reformationstag' },
  { date: '2030-12-25', name: '1. Weihnachtstag' },
  { date: '2030-12-26', name: '2. Weihnachtstag' },
];

const BY_BUNDESLAND: Readonly<Record<Bundesland, readonly PublicHoliday[]>> = {
  HH: HAMBURG_2026_2030,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** The holiday on the given calendar date, or null. Date must be YYYY-MM-DD. */
export function publicHolidayOn(date: string, bundesland: Bundesland = 'HH'): PublicHoliday | null {
  if (!DATE_RE.test(date)) throw new RangeError('date must be YYYY-MM-DD');
  return BY_BUNDESLAND[bundesland].find((h) => h.date === date) ?? null;
}

/** True when the calendar date is a public holiday in the given Bundesland. */
export function isPublicHoliday(date: string, bundesland: Bundesland = 'HH'): boolean {
  return publicHolidayOn(date, bundesland) !== null;
}

/** Years covered by the dataset for the given Bundesland (the yearly-update reminder reads this). */
export function coveredYears(bundesland: Bundesland = 'HH'): readonly number[] {
  const years = new Set<number>();
  for (const h of BY_BUNDESLAND[bundesland]) years.add(Number(h.date.slice(0, 4)));
  return [...years].sort((a, b) => a - b);
}
