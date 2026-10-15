/**
 * Knowledge cards editor (P13.06.01/.02): card list by category with
 * draft/approved/retired badges, approve/reject transitions feeding the
 * P09.05 approval path. Pure shapes; loaders and the TTS preview ride
 * separately (P13.06.03/.04).
 */

export type CardStatus = 'draft' | 'approved' | 'retired';
export type CardDecision = 'approve' | 'reject';

export interface KnowledgeCard {
  readonly id: string;
  readonly category: string;
  readonly question: string;
  readonly status: CardStatus;
}

/** Group cards by category, categories in first-seen order. */
export function cardsByCategory(
  cards: readonly KnowledgeCard[],
): Readonly<Record<string, readonly KnowledgeCard[]>> {
  const grouped: Record<string, KnowledgeCard[]> = {};
  for (const card of cards) {
    (grouped[card.category] ??= []).push(card);
  }
  return grouped;
}

/** Badge label per status (German, owner-facing). */
export function statusBadge(status: CardStatus): string {
  if (status === 'draft') return 'Entwurf';
  if (status === 'approved') return 'Freigegeben';
  return 'Archiviert';
}

/** Next status after a decision; drafts-only transitions (P09.05). */
export function decideCard(card: KnowledgeCard, decision: CardDecision): CardStatus | null {
  if (card.status !== 'draft') return null;
  return decision === 'approve' ? 'approved' : 'retired';
}
