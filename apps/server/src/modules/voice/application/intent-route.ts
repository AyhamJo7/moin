/**
 * Intent capture + NLU routing (P12.02 slice, T-22 uncertainty).
 *
 * Caller utterance → NLU result → turn action. Low confidence escalates
 * (uncertainty always escalates on sensitive paths) instead of guessing.
 * The full policy engine (`decide` in @moin/ai) owns the action table;
 * this module is the voice-side wiring — confidence gating plus the
 * escalate/transfer short-circuits — kept local so the server needs no new
 * package edge for three branches. Pure, no I/O.
 */

export type TurnAction = 'answer' | 'ask_slot' | 'create' | 'escalate' | 'transfer' | 'fallback';

/** Below this confidence the turn escalates rather than guesses (T-22). */
export const LOW_CONFIDENCE_ESCALATION = 0.5;

export interface NluResult {
  readonly intent: string;
  readonly confidence: number;
  readonly slots: Readonly<Record<string, string>>;
  readonly wantsHuman: boolean;
  readonly emergencySuspected: boolean;
}

export interface IntentRouteContext {
  readonly enabledIntents: ReadonlySet<string>;
  readonly requiredSlots: Readonly<Record<string, readonly string[]>>;
}

export interface TurnDecision {
  readonly action: TurnAction;
  readonly intent: string;
  readonly slot?: string;
}

export function routeUtterance(
  nlu: NluResult,
  context: IntentRouteContext,
  lowConfidenceAt: number = LOW_CONFIDENCE_ESCALATION,
): TurnDecision {
  if (nlu.emergencySuspected) return { action: 'escalate', intent: nlu.intent };
  if (nlu.wantsHuman) return { action: 'transfer', intent: nlu.intent };
  // Low confidence: unknown intent → fallback path upstream (T-22).
  if (nlu.confidence < lowConfidenceAt) return { action: 'fallback', intent: 'unknown' };
  if (!context.enabledIntents.has(nlu.intent)) return { action: 'escalate', intent: nlu.intent };
  const missing = (context.requiredSlots[nlu.intent] ?? []).find(
    (slot) => nlu.slots[slot] === undefined || nlu.slots[slot] === '',
  );
  if (missing !== undefined) return { action: 'ask_slot', intent: nlu.intent, slot: missing };
  if (nlu.intent.startsWith('create_')) return { action: 'create', intent: nlu.intent };
  return { action: 'answer', intent: nlu.intent };
}
