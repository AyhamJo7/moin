/**
 * Deterministic policy engine (P10.07, BR-125/127, INV-05).
 *
 * Pure decision function: tenant config + interaction context + validated NLU
 * in, action + reason code out. No I/O, no clock, no model — after-hours
 * arrives as a boolean the caller computed with the opening-hours engine, so
 * this module never imports time or database code.
 *
 * The ladder rung: a table of intents with slot schemas could be its own
 * template system (P10.09) — here intents are names with required slots, and
 * templates arrive as data (`enabledIntents`), not files.
 *
 * INV-05: only `create` carries a commitment, and it carries a `toolName`,
 * never a result — the tool guard (P10.08) issues the token after execution.
 * The property test asserts no decision path returns a `committed: true`.
 */

export type PolicyAction =
  'ask_slot' | 'answer' | 'create' | 'escalate' | 'transfer' | 'fallback' | 'end';

export type ReasonCode =
  | 'intent-disabled'
  | 'unsupported-request'
  | 'missing-slot'
  | 'after-hours'
  | 'no-entitlement'
  | 'low-confidence'
  | 'wants-human'
  | 'emergency'
  | 'ready'
  | 'farewell'
  | 'unintelligible';

export interface PolicyNlu {
  readonly intent: string;
  readonly confidence: number;
  readonly slots: Readonly<Record<string, string>>;
  readonly wantsHuman: boolean;
  readonly emergencySuspected: boolean;
}

export interface PolicyContext {
  /** Intents the tenant enabled (template binding, P10.09 data shape). */
  readonly enabledIntents: ReadonlySet<string>;
  /** Required slots per intent. */
  readonly requiredSlots: Readonly<Record<string, readonly string[]>>;
  /** Caller computed via the opening-hours engine. */
  readonly afterHours: boolean;
  /** Whether the tenant is entitled to agentic creation (P10.07.02). */
  readonly entitledToCreate: boolean;
  /** Below this the turn clarifies once, then captures (uncertainty policy). */
  readonly minConfidence: number;
}

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly reason: ReasonCode;
  /** Intent the decision was made for (absent on fallback/end). */
  readonly intent?: string;
  /** First missing required slot (ask_slot only). */
  readonly slot?: string;
  /** Tool to invoke (create only — the guard issues the token). */
  readonly toolName?: string;
  /** Commitments are never produced here (INV-05 property). */
  readonly committed: false;
}

/** Requests outside the template's tool set escalate (BR-125/127). */
const UNSUPPORTED = new Set(['refund', 'payment', 'contract_change']);

const CONFIDENCE_ASK = 'low-confidence';

export function decide(nlu: PolicyNlu, context: PolicyContext): PolicyDecision {
  if (nlu.emergencySuspected) return { action: 'escalate', reason: 'emergency', committed: false };
  if (nlu.wantsHuman) {
    return { action: 'transfer', reason: 'wants-human', intent: nlu.intent, committed: false };
  }
  if (UNSUPPORTED.has(nlu.intent) || nlu.intent === 'farewell') {
    return nlu.intent === 'farewell'
      ? { action: 'end', reason: 'farewell', committed: false }
      : { action: 'escalate', reason: 'unsupported-request', intent: nlu.intent, committed: false };
  }
  if (!context.enabledIntents.has(nlu.intent)) {
    return nlu.intent === 'unknown'
      ? { action: 'fallback', reason: 'unintelligible', committed: false }
      : { action: 'escalate', reason: 'intent-disabled', intent: nlu.intent, committed: false };
  }
  if (context.afterHours) {
    return { action: 'escalate', reason: 'after-hours', intent: nlu.intent, committed: false };
  }
  if (nlu.confidence < context.minConfidence) {
    return { action: 'ask_slot', reason: CONFIDENCE_ASK, intent: nlu.intent, committed: false };
  }
  const missing = (context.requiredSlots[nlu.intent] ?? []).find(
    (slot) => nlu.slots[slot] === undefined || nlu.slots[slot] === '',
  );
  if (missing !== undefined) {
    return {
      action: 'ask_slot',
      reason: 'missing-slot',
      intent: nlu.intent,
      slot: missing,
      committed: false,
    };
  }
  if (nlu.intent.startsWith('create_')) {
    if (!context.entitledToCreate) {
      return { action: 'escalate', reason: 'no-entitlement', intent: nlu.intent, committed: false };
    }
    return {
      action: 'create',
      reason: 'ready',
      intent: nlu.intent,
      toolName: nlu.intent,
      committed: false,
    };
  }
  return { action: 'answer', reason: 'ready', intent: nlu.intent, committed: false };
}
