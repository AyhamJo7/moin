/**
 * Knowledge cards (P13.06.01/.02): category grouping, German badges,
 * draft-only approve/reject transitions.
 */
import { describe, expect, it } from 'vitest';
import { cardsByCategory, decideCard, statusBadge } from './knowledge.ts';

describe('knowledge cards', () => {
  it('groups cards by category in first-seen order', () => {
    const grouped = cardsByCategory([
      { id: 'a', category: 'Öffnungszeiten', question: 'Wann?', status: 'draft' },
      { id: 'b', category: 'Preise', question: 'Wieviel?', status: 'approved' },
      { id: 'c', category: 'Öffnungszeiten', question: 'Sonntag?', status: 'retired' },
    ]);
    expect(Object.keys(grouped)).toStrictEqual(['Öffnungszeiten', 'Preise']);
    expect(grouped['Öffnungszeiten']?.map((c) => c.id)).toStrictEqual(['a', 'c']);
  });

  it('badges every status in German', () => {
    expect(statusBadge('draft')).toBe('Entwurf');
    expect(statusBadge('approved')).toBe('Freigegeben');
    expect(statusBadge('retired')).toBe('Archiviert');
  });

  it('approves/rejects drafts only (P09.05 path shape)', () => {
    const draft = { id: 'a', category: 'k', question: 'q', status: 'draft' as const };
    expect(decideCard(draft, 'approve')).toBe('approved');
    expect(decideCard(draft, 'reject')).toBe('retired');
    const live = { ...draft, status: 'approved' as const };
    expect(decideCard(live, 'reject')).toBeNull();
  });
});
