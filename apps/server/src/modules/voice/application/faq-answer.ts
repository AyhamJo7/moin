/**
 * FAQ answering from approved cards (P12.06, INV-08, T-22).
 *
 * Caller question → approved-card lookup → `spoken_answer` verbatim.
 * Sensitive cards answer only through this path (their sole mode);
 * no match escalates with the BR-129 uncertainty sentence + callback
 * offer. The lookup is a port (DB `findAnswer` in production); this
 * module owns the verbatim-or-escalate decision, never the wording.
 */

export interface ApprovedAnswer {
  readonly spoken: string;
  readonly stale: boolean;
}

export type FaqTurn =
  | { readonly kind: 'answer'; readonly spoken: string }
  | { readonly kind: 'escalate'; readonly reason: 'no-match' };

/** Uncertainty sentence + callback offer (BR-129). */
export const FAQ_UNCERTAINTY =
  'Das kann ich gerade nicht zuverlässig beantworten. Darf ich einen Rückruf für Sie aufnehmen?' as const;

export interface FaqLookup {
  readonly find: (question: string) => Promise<ApprovedAnswer | null>;
}

/** Verbatim answer or escalate — never paraphrase, never invent (INV-08). */
export async function answerFaq(question: string, lookup: FaqLookup): Promise<FaqTurn> {
  const hit = await lookup.find(question);
  if (hit === null) return { kind: 'escalate', reason: 'no-match' };
  return { kind: 'answer', spoken: hit.spoken };
}
