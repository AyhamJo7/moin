/**
 * Turn-log policy (P16.17): enforced + TTL-present.
 */
import { describe, expect, it } from 'vitest';
import {
  turnFieldsValid,
  turnLogAllowed,
  FREE_TEXT_MAX,
  TURN_LOG_TTL_DAYS,
} from './turnlog-policy.ts';

describe('turn-log policy', () => {
  it('enforces template-facts-only with the free-text cap', () => {
    expect(
      turnFieldsValid({
        templateFacts: { intent: 'callback' },
        freeText: 'x',
        botUtteranceRef: 'tpl:1',
      }),
    ).toBe(true);
    expect(
      turnFieldsValid({
        templateFacts: {},
        freeText: 'y'.repeat(FREE_TEXT_MAX + 1),
        botUtteranceRef: 'tpl:1',
      }),
    ).toBe(false);
    expect(turnFieldsValid({ templateFacts: {}, freeText: '', botUtteranceRef: '  ' })).toBe(false);
  });

  it('gates the redacted log on instruction + approval with a 7-day TTL', () => {
    expect(TURN_LOG_TTL_DAYS).toBe(7);
    expect(turnLogAllowed({ tenantInstruction: true, ext02Approval: true })).toBe(true);
    expect(turnLogAllowed({ tenantInstruction: true, ext02Approval: false })).toBe(false);
    expect(turnLogAllowed({ tenantInstruction: false, ext02Approval: true })).toBe(false);
  });
});
