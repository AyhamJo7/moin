/**
 * Inbox stream and filters (P13.04.01): one chronological actionable
 * stream — Braucht mich · Wartet · Erledigt · Telefon — over
 * caller-supplied rows. Cursor pagination and search ride separately
 * (P13.04.02, LAUNCH via P07.12). Pure, no I/O.
 */

export type InboxFilter = 'needs-me' | 'waiting' | 'done' | 'phone';

export interface InboxRow {
  readonly id: string;
  readonly atMs: number;
  readonly filter: InboxFilter;
  readonly label: string;
  readonly cursor: string;
}

/** Newest-first stream order. */
export function orderStream(rows: readonly InboxRow[]): readonly InboxRow[] {
  return [...rows].sort((a, b) => b.atMs - a.atMs);
}

/** Filter the stream; `phone` matches phone-channel rows only. */
export function filterStream(rows: readonly InboxRow[], filter: InboxFilter): readonly InboxRow[] {
  return orderStream(rows).filter((r) => r.filter === filter);
}
