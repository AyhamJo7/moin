/**
 * Interaction cards (P13.03.01/.02): owner card per interaction — person,
 * time + channel, reason, facts, result, next action — plus the action set
 * (call, assign, done, later, note) with idempotency keys. Pure shapes;
 * the loaders and the 409 handling ride separately.
 */

export type CardAction = 'call' | 'assign' | 'done' | 'later' | 'note';

export const CARD_ACTIONS: readonly CardAction[] = ['call', 'assign', 'done', 'later', 'note'];

export interface InteractionCard {
  readonly id: string;
  readonly person: string;
  readonly time: string;
  readonly channel: 'call' | 'message';
  readonly reason: string;
  readonly facts: Readonly<Record<string, string>>;
  readonly result: string;
  readonly nextAction: string;
  readonly actions: readonly CardAction[];
}

/** Every card carries the full action set — the UI hides, never invents. */
export function cardActions(): readonly CardAction[] {
  return CARD_ACTIONS;
}

/** Idempotency key for a card action: stable per card + action. */
export function actionKey(cardId: string, action: CardAction): string {
  return `${cardId}:${action}`;
}
