/**
 * Escalation + handoff turn (P12 brief slice; INV-06/19).
 *
 * Escalate → urgent task + owner notification (P14 path stubbed as a
 * record — the notify transport rides separately) + callback offer.
 * Transfer-request → handoff message naming the human route. Pure turn
 * logic; the task/notification writes ride the guard paths.
 */

export type EscalateTurn =
  | {
      readonly kind: 'escalated';
      readonly taskPriority: 'high';
      readonly notifyOwner: true;
      readonly callbackOffer: true;
    }
  | { readonly kind: 'handoff'; readonly message: string };

/** Handoff message for transfer requests (human route named). */
export const HANDOFF_MESSAGE =
  'Ich verbinde Sie mit einem Mitarbeiter. Einen Moment bitte.' as const;

export function escalateTurn(): EscalateTurn {
  return { kind: 'escalated', taskPriority: 'high', notifyOwner: true, callbackOffer: true };
}

export function handoffTurn(): EscalateTurn {
  return { kind: 'handoff', message: HANDOFF_MESSAGE };
}
