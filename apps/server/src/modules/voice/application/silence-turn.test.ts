/**
 * Silence / speech-failure / barge-in (P12.11.01–.03, INV-19): reprompt
 * once then wrap, BR-117 German reprompt then fallback, interrupted
 * commitments re-spoken never assumed.
 */
import { describe, expect, it } from 'vitest';
import {
  bargeInTurn,
  silenceTurn,
  SILENCE_REPROMPT,
  speechFailureTurn,
  UNINTELLIGIBLE_REPROMPT,
} from './silence-turn.ts';

describe('silence turn', () => {
  it('reprompts once on 8 s silence, then wraps with callback', () => {
    expect(silenceTurn(false)).toStrictEqual({ step: 'reprompt', line: SILENCE_REPROMPT });
    expect(silenceTurn(true)).toStrictEqual({ step: 'wrap-callback' });
    expect(SILENCE_REPROMPT).toContain('Sind Sie noch da');
  });

  it('reprompts unintelligible speech in German once, then falls back (BR-117)', () => {
    expect(speechFailureTurn(false)).toStrictEqual({
      step: 'reprompt',
      line: UNINTELLIGIBLE_REPROMPT,
    });
    expect(UNINTELLIGIBLE_REPROMPT).toContain('Entschuldigung');
    expect(speechFailureTurn(true)).toStrictEqual({ step: 'fallback' });
  });

  it('barge-in stops and keeps the utterance; commitments re-speak', () => {
    expect(bargeInTurn('Ich möchte einen Tisch', false)).toStrictEqual({
      step: 'stop-and-listen',
      keptUtterance: 'Ich möchte einen Tisch',
    });
    expect(bargeInTurn('Ja, buchen Sie', true)).toStrictEqual({
      step: 're-speak',
      keptUtterance: 'Ja, buchen Sie',
    });
  });
});
