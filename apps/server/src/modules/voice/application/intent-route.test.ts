/**
 * NLU → decision wiring (P12.02 slice, T-22): confident utterances route;
 * low confidence escalates via unknown; emergency and human pass through.
 */
import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE_ESCALATION, routeUtterance } from './intent-route.ts';
import type { IntentRouteContext } from './intent-route.ts';

function context(): IntentRouteContext {
  return {
    enabledIntents: new Set(['faq_hours', 'create_callback']),
    requiredSlots: { create_callback: ['callback_phone'] },
  };
}

describe('intent routing', () => {
  it('routes confident utterances to answer / ask_slot / create', () => {
    expect(
      routeUtterance(
        {
          intent: 'faq_hours',
          confidence: 0.9,
          slots: {},
          wantsHuman: false,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'answer', intent: 'faq_hours' });
    expect(
      routeUtterance(
        {
          intent: 'create_callback',
          confidence: 0.9,
          slots: {},
          wantsHuman: false,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'ask_slot', intent: 'create_callback', slot: 'callback_phone' });
    expect(
      routeUtterance(
        {
          intent: 'create_callback',
          confidence: 0.9,
          slots: { callback_phone: '+49151' },
          wantsHuman: false,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'create', intent: 'create_callback' });
  });

  it('low confidence escalates instead of guessing (T-22)', () => {
    expect(LOW_CONFIDENCE_ESCALATION).toBe(0.5);
    expect(
      routeUtterance(
        {
          intent: 'faq_hours',
          confidence: 0.2,
          slots: {},
          wantsHuman: false,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'fallback', intent: 'unknown' });
  });

  it('emergency, human and disabled intents route correctly', () => {
    expect(
      routeUtterance(
        {
          intent: 'faq_hours',
          confidence: 0.9,
          slots: {},
          wantsHuman: true,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'transfer', intent: 'faq_hours' });
    expect(
      routeUtterance(
        {
          intent: 'faq_hours',
          confidence: 0.9,
          slots: {},
          wantsHuman: false,
          emergencySuspected: true,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'escalate', intent: 'faq_hours' });
    expect(
      routeUtterance(
        {
          intent: 'refund',
          confidence: 0.9,
          slots: {},
          wantsHuman: false,
          emergencySuspected: false,
        },
        context(),
      ),
    ).toStrictEqual({ action: 'escalate', intent: 'refund' });
  });
});
