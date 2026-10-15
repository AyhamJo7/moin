/**
 * Customers and contact timeline (P13.05.01): per-customer timeline of
 * calls/tasks/leads/notes in chronological order, plus name lookup.
 * Pure shapes over caller-supplied rows; loaders and edits ride
 * separately (P13.05.03 E2E).
 */

export type TimelineKind = 'call' | 'task' | 'lead' | 'note';

export interface TimelineEntry {
  readonly id: string;
  readonly customerId: string;
  readonly atMs: number;
  readonly kind: TimelineKind;
  readonly label: string;
}

export interface Customer {
  readonly id: string;
  readonly name: string;
}

/** Oldest-first timeline for one customer. */
export function customerTimeline(
  entries: readonly TimelineEntry[],
  customerId: string,
): readonly TimelineEntry[] {
  return entries.filter((e) => e.customerId === customerId).sort((a, b) => a.atMs - b.atMs);
}

/** Case-insensitive name lookup over the customer list. */
export function lookupCustomer(customers: readonly Customer[], name: string): Customer | null {
  const needle = name.trim().toLowerCase();
  return customers.find((c) => c.name.toLowerCase().includes(needle)) ?? null;
}
