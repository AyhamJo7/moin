/**
 * AI-Act disclosure (P16.12): recorded + trace-linked.
 */
import { describe, expect, it } from 'vitest';
import { disclosureRecorded, traceLinks } from './disclosure.ts';

const CALL = '11111111-1111-4111-8111-111111111111';

describe('ai-act disclosure', () => {
  it('records the disclosure proof per AI call', () => {
    expect(
      disclosureRecorded({
        callId: CALL,
        aiInvolved: true,
        disclosurePlayed: true,
        disclosureVersion: 'v3',
      }),
    ).toBe(true);
    expect(
      disclosureRecorded({
        callId: CALL,
        aiInvolved: true,
        disclosurePlayed: false,
        disclosureVersion: '',
      }),
    ).toBe(false);
    expect(
      disclosureRecorded({
        callId: CALL,
        aiInvolved: false,
        disclosurePlayed: false,
        disclosureVersion: '',
      }),
    ).toBe(true);
    expect(
      disclosureRecorded({
        callId: 'nope',
        aiInvolved: false,
        disclosurePlayed: false,
        disclosureVersion: '',
      }),
    ).toBe(false);
  });

  it('links the call to model/prompt/policy versions', () => {
    expect(
      traceLinks({ callId: CALL, modelVersion: 'm1', promptVersion: 'p2', policyVersion: 'po3' }),
    ).toBe(true);
    expect(
      traceLinks({ callId: CALL, modelVersion: '', promptVersion: 'p2', policyVersion: 'po3' }),
    ).toBe(false);
  });
});
