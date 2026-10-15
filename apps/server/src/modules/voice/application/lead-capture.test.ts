/**
 * Lead capture (P12.08.01): slot loop asks in order, ready lead when
 * complete, escalation after two unfilled attempts.
 */
import { describe, expect, it } from 'vitest';
import { leadTurn } from './lead-capture.ts';

describe('lead capture', () => {
  it('asks missing slots in order, then reports ready', () => {
    expect(leadTurn({}, 0)).toStrictEqual({ step: 'ask', slot: 'name' });
    expect(leadTurn({ name: 'Anna' }, 0)).toStrictEqual({ step: 'ask', slot: 'need' });
    expect(leadTurn({ name: 'Anna', need: 'Geburtstag' }, 0)).toStrictEqual({
      step: 'ask',
      slot: 'contact',
    });
    expect(leadTurn({ name: 'Anna', need: 'Geburtstag', contact: '+49151' }, 0)).toStrictEqual({
      step: 'ready',
      name: 'Anna',
      need: 'Geburtstag',
      contact: '+49151',
    });
  });

  it('escalates after two unfilled attempts (INV-06)', () => {
    expect(leadTurn({}, 1)).toStrictEqual({ step: 'ask', slot: 'name' });
    expect(leadTurn({}, 2)).toStrictEqual({ step: 'escalate', reason: 'slots-unfilled' });
    expect(leadTurn({ name: '  ' }, 2)).toStrictEqual({
      step: 'escalate',
      reason: 'slots-unfilled',
    });
  });
});
