/**
 * Silence / speech-failure / interruption handling (P12.11.01–.03, INV-19).
 *
 * Silence 8 s → reprompt once → wrap with callback capture when a number
 * is known. Unintelligible speech → one German reprompt (BR-117), then
 * fallback. Barge-in → stop speaking, keep `utteranceUntilInterrupt`, and
 * never treat interrupted commitments or read-backs as delivered. Pure
 * turn logic; the STT engine and the media transport ride separately.
 */

export const SILENCE_REPROMPT = 'Sind Sie noch da? Womit kann ich Ihnen helfen?' as const;
export const UNINTELLIGIBLE_REPROMPT =
  'Entschuldigung, ich habe Sie nicht verstanden. Könnten Sie das bitte wiederholen?' as const;

export type SilenceStep =
  | { readonly step: 'reprompt'; readonly line: typeof SILENCE_REPROMPT }
  | { readonly step: 'wrap-callback' }
  | { readonly step: 'keep-listening' };

export type SpeechStep =
  | { readonly step: 'reprompt'; readonly line: typeof UNINTELLIGIBLE_REPROMPT }
  | { readonly step: 'fallback' };

export type BargeStep =
  | { readonly step: 'stop-and-listen'; readonly keptUtterance: string }
  | { readonly step: 're-speak'; readonly keptUtterance: string };

/** Silence path: first timeout reprompts, second wraps (number known or not — wrap either way, callback only when known). */
export function silenceTurn(reprompted: boolean): SilenceStep {
  if (!reprompted) return { step: 'reprompt', line: SILENCE_REPROMPT };
  return { step: 'wrap-callback' };
}

/** Unintelligible path: one German reprompt, then fallback (BR-117). */
export function speechFailureTurn(reprompted: boolean): SpeechStep {
  if (!reprompted) return { step: 'reprompt', line: UNINTELLIGIBLE_REPROMPT };
  return { step: 'fallback' };
}

/**
 * Barge-in: stop speaking and keep the partial utterance. A read-back or
 * commitment interrupted mid-speech was NOT delivered — the caller must
 * confirm again (`re-speak`), never assume.
 */
export function bargeInTurn(utteranceUntilInterrupt: string, wasCommitment: boolean): BargeStep {
  if (wasCommitment) return { step: 're-speak', keptUtterance: utteranceUntilInterrupt };
  return { step: 'stop-and-listen', keptUtterance: utteranceUntilInterrupt };
}
