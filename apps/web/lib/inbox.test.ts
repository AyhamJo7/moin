/**
 * Inbox stream (P13.04.01): newest-first order, per-filter correctness.
 */
import { describe, expect, it } from 'vitest';
import { filterStream, orderStream } from './inbox.ts';
import type { InboxRow } from './inbox.ts';

const ROWS: InboxRow[] = [
  { id: 'a', atMs: 100, filter: 'needs-me', label: 'Notfall', cursor: 'a' },
  { id: 'b', atMs: 300, filter: 'phone', label: 'Anruf', cursor: 'b' },
  { id: 'c', atMs: 200, filter: 'needs-me', label: 'Rückruf', cursor: 'c' },
  { id: 'd', atMs: 400, filter: 'done', label: 'Erledigt', cursor: 'd' },
];

describe('inbox stream', () => {
  it('orders newest-first', () => {
    expect(orderStream(ROWS).map((r) => r.id)).toStrictEqual(['d', 'b', 'c', 'a']);
  });

  it('filters return the correct items', () => {
    expect(filterStream(ROWS, 'needs-me').map((r) => r.id)).toStrictEqual(['c', 'a']);
    expect(filterStream(ROWS, 'phone').map((r) => r.id)).toStrictEqual(['b']);
    expect(filterStream(ROWS, 'waiting')).toStrictEqual([]);
    expect(filterStream(ROWS, 'done').map((r) => r.id)).toStrictEqual(['d']);
  });
});
