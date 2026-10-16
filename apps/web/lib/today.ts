/**
 * Today page aggregation (P13.02.01–.03).
 *
 * Owner's morning view: urgent items, callbacks, new requests, appointments
 * to confirm, open questions — plus the "automatically handled" counts and
 * reassuring empty states ("Alles erledigt", never blank). Pure
 * aggregation over caller-supplied rows; the loaders ride separately.
 */

export type TodaySection = 'urgent' | 'callbacks' | 'requests' | 'appointments' | 'questions';

export interface TodayItem {
  readonly id: string;
  readonly section: TodaySection;
  readonly label: string;
}

export interface TodaySummary {
  readonly callsAnswered: number;
  readonly faqsResolved: number;
  readonly requestsCaptured: number;
  readonly enquiriesRouted: number;
}

export const TODAY_EMPTY = 'Alles erledigt.' as const;

/** Group rows by section, sections in owner-priority order. */
export function groupToday<T extends Pick<TodayItem, 'section'>>(
  items: readonly T[],
): Readonly<Record<TodaySection, readonly T[]>> {
  const grouped: Record<TodaySection, T[]> = {
    urgent: [],
    callbacks: [],
    requests: [],
    appointments: [],
    questions: [],
  };
  for (const item of items) grouped[item.section].push(item);
  return grouped;
}

/** Empty-state line: reassuring, never blank (P13.02.03, same in every section). */
export function emptyLine(): string {
  return TODAY_EMPTY;
}
