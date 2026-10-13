/**
 * Callback capture (P12.09.01): number capture, read-back, confirm,
 * two-strikes escalation. Synthetic numbers only.
 */
import { describe, expect, it } from 'vitest';
import { captureTurn, confirmTurn, readBackNumber } from './callback-capture.ts';

describe('callback capture', () => {
  it('captures digits and confirms with read-back', () => {
    const turn = captureTurn('+49 151 234 5678', 0);
    expect(turn).toStrictEqual({ step: 'confirm-number', number: '491512345678' });
    if (turn.step === 'confirm-number') {
      expect(readBackNumber(turn.number)).toContain('4 9 1 5 1');
      expect(confirmTurn(true, turn.number)).toStrictEqual({
        step: 'captured',
        number: '491512345678',
      });
      expect(confirmTurn(false, turn.number)).toStrictEqual({ step: 'ask-number' });
    } else {
      throw new Error('expected confirm-number');
    }
  });

  it('escalates after two unintelligible attempts (INV-06)', () => {
    expect(captureTurn(null, 0)).toStrictEqual({ step: 'ask-number' });
    expect(captureTurn('', 1)).toStrictEqual({ step: 'ask-number' });
    expect(captureTurn(null, 2)).toStrictEqual({
      step: 'escalate',
      reason: 'unintelligible-number',
    });
    expect(captureTurn('abc', 2)).toStrictEqual({
      step: 'escalate',
      reason: 'unintelligible-number',
    });
  });
});
