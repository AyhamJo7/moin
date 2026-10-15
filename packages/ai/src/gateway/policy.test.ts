/**
 * Policy engine tables (P10.07.01–.04, BR-125/127, INV-05): one row per
 * (nlu × context) case; plus the property that no path commits.
 */
import { describe, expect, it } from 'vitest';
import { decide } from './policy.ts';
import type { PolicyContext, PolicyNlu } from './policy.ts';

const CTX: PolicyContext = {
  enabledIntents: new Set(['faq_hours', 'create_callback', 'create_lead']),
  requiredSlots: { create_callback: ['callback_phone'], create_lead: ['caller_name'] },
  afterHours: false,
  entitledToCreate: true,
  minConfidence: 0.5,
};

function nlu(over: Partial<PolicyNlu> = {}): PolicyNlu {
  return {
    intent: 'faq_hours',
    confidence: 0.9,
    slots: {},
    wantsHuman: false,
    emergencySuspected: false,
    ...over,
  };
}

describe('policy engine', () => {
  it('answers a complete enabled intent; asks for the first missing slot', () => {
    expect(decide(nlu(), CTX)).toMatchObject({ action: 'answer', reason: 'ready' });
    expect(decide(nlu({ intent: 'create_callback', slots: {} }), CTX)).toMatchObject({
      action: 'ask_slot',
      reason: 'missing-slot',
      slot: 'callback_phone',
    });
    expect(
      decide(nlu({ intent: 'create_callback', slots: { callback_phone: '+49151' } }), CTX),
    ).toMatchObject({ action: 'create', reason: 'ready', toolName: 'create_callback' });
  });

  it('escalates unsupported, disabled, after-hours, unentitled, human and emergency', () => {
    expect(decide(nlu({ intent: 'refund' }), CTX)).toMatchObject({
      action: 'escalate',
      reason: 'unsupported-request',
    });
    expect(decide(nlu({ intent: 'payment' }), CTX)).toMatchObject({
      action: 'escalate',
      reason: 'unsupported-request',
    });
    expect(decide(nlu({ intent: 'contract_change' }), CTX)).toMatchObject({
      action: 'escalate',
      reason: 'unsupported-request',
    });
    expect(decide(nlu({ intent: 'booking_create' }), CTX)).toMatchObject({
      action: 'escalate',
      reason: 'intent-disabled',
    });
    expect(decide(nlu(), { ...CTX, afterHours: true })).toMatchObject({
      action: 'escalate',
      reason: 'after-hours',
    });
    expect(
      decide(nlu({ intent: 'create_lead', slots: { caller_name: 'A' } }), {
        ...CTX,
        entitledToCreate: false,
      }),
    ).toMatchObject({ action: 'escalate', reason: 'no-entitlement' });
    expect(decide(nlu({ wantsHuman: true }), CTX)).toMatchObject({
      action: 'transfer',
      reason: 'wants-human',
    });
    expect(decide(nlu({ emergencySuspected: true }), CTX)).toMatchObject({
      action: 'escalate',
      reason: 'emergency',
    });
  });

  it('clarifies on low confidence, falls back on unknown, ends on farewell', () => {
    expect(decide(nlu({ confidence: 0.2 }), CTX)).toMatchObject({
      action: 'ask_slot',
      reason: 'low-confidence',
    });
    expect(decide(nlu({ intent: 'unknown' }), CTX)).toMatchObject({
      action: 'fallback',
      reason: 'unintelligible',
    });
    expect(decide(nlu({ intent: 'farewell' }), CTX)).toMatchObject({
      action: 'end',
      reason: 'farewell',
    });
  });

  it('no path produces a commitment without a tool token (INV-05 property)', () => {
    const intents = [
      'faq_hours',
      'create_callback',
      'create_lead',
      'refund',
      'payment',
      'contract_change',
      'booking_create',
      'unknown',
      'farewell',
    ];
    const decisions = [];
    for (const intent of intents) {
      for (const afterHours of [false, true]) {
        for (const entitledToCreate of [false, true]) {
          for (const wantsHuman of [false, true]) {
            for (const emergencySuspected of [false, true]) {
              for (const confidence of [0, 0.9]) {
                decisions.push(
                  decide(nlu({ intent, confidence, wantsHuman, emergencySuspected }), {
                    ...CTX,
                    afterHours,
                    entitledToCreate,
                  }),
                );
              }
            }
          }
        }
      }
    }
    expect(decisions.length).toBeGreaterThan(200);
    for (const d of decisions) expect(d.committed).toBe(false);
  });
});
