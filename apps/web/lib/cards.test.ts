/**
 * Interaction cards (P13.03.01/.02): shape carries every field, the full
 * action set is present, keys are stable per card + action.
 */
import { describe, expect, it } from 'vitest';
import { actionKey, cardActions } from './cards.ts';
import type { InteractionCard } from './cards.ts';

describe('interaction cards', () => {
  it('carries the full card shape', () => {
    const card: InteractionCard = {
      id: 'c1',
      person: 'Anna Schmidt',
      time: '09:41',
      channel: 'call',
      reason: 'Rückruf',
      facts: { Anliegen: 'Öffnungszeiten' },
      result: 'Beantwortet',
      nextAction: 'Keine',
      actions: cardActions(),
    };
    expect(card.person).toBe('Anna Schmidt');
    expect(card.facts['Anliegen']).toBe('Öffnungszeiten');
    expect(card.actions).toStrictEqual(['call', 'assign', 'done', 'later', 'note']);
  });

  it('keys actions stably per card + action (409 handling shape)', () => {
    expect(actionKey('c1', 'done')).toBe('c1:done');
    expect(actionKey('c1', 'done')).toBe(actionKey('c1', 'done'));
    expect(actionKey('c1', 'later')).not.toBe(actionKey('c1', 'done'));
  });
});
