/**
 * Escalation + handoff (P12 brief slice, INV-06/19): urgent task +
 * notify + callback offer; handoff names the human route.
 */
import { describe, expect, it } from 'vitest';
import { escalateTurn, HANDOFF_MESSAGE, handoffTurn } from './escalate-turn.ts';

describe('escalation turn', () => {
  it('escalates with urgent task + owner notify + callback offer', () => {
    expect(escalateTurn()).toStrictEqual({
      kind: 'escalated',
      taskPriority: 'high',
      notifyOwner: true,
      callbackOffer: true,
    });
  });

  it('hands off with the human-route message', () => {
    expect(HANDOFF_MESSAGE).toContain('Mitarbeiter');
    expect(handoffTurn()).toStrictEqual({ kind: 'handoff', message: HANDOFF_MESSAGE });
  });
});
