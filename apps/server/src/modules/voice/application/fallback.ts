/**
 * Fallback layers (P11.07, INV-19, LG-V10, BR-129).
 *
 * When a layer fails the next one answers — every path ends in a spoken
 * message plus a callback capture or human route, never silence:
 * - NLU failure → deterministic capture (ask for a callback, DTMF confirm).
 * - Gateway down → template response (static apology + callback offer).
 * - STT failure → reprompt once, then capture.
 * - Full cascade → hosted fallback TwiML (Twilio-hosted, versioned in Git).
 *
 * Pure decision functions: which layer answers given what failed. The
 * TwiML builders and the hosted-fallback deploy ride separately; this
 * module is the layer table the tests pin.
 */

export type FailedLayer =
  'nlu' | 'gateway' | 'stt' | 'ws' | 'db' | 'valkey' | 'app-down' | 'app-slow';

export type FallbackAnswer =
  | { readonly layer: 'deterministic-capture'; readonly dtmfConfirm: true }
  | { readonly layer: 'template-response' }
  | { readonly layer: 'reprompt-then-capture'; readonly reprompted: boolean }
  | { readonly layer: 'hosted-fallback' };

/** German fallback texts (BR-129 wording, reviewed with the templates). */
export const FALLBACK_APOLOGY = 'Es tut uns leid, gerade ist etwas schiefgelaufen.' as const;
export const FALLBACK_CALLBACK_ASK =
  'Drücken Sie die 1, wenn wir Sie unter dieser Nummer zurückrufen dürfen.' as const;

export function fallbackFor(failures: ReadonlySet<FailedLayer>): FallbackAnswer {
  // Total outage answers from the hosted fallback — nothing local can speak.
  if (failures.has('app-down') || failures.has('app-slow')) {
    return { layer: 'hosted-fallback' };
  }
  if (failures.has('ws')) return { layer: 'hosted-fallback' };
  if (failures.has('gateway')) return { layer: 'template-response' };
  if (failures.has('nlu')) return { layer: 'deterministic-capture', dtmfConfirm: true };
  if (failures.has('stt')) return { layer: 'reprompt-then-capture', reprompted: false };
  if (failures.has('db') || failures.has('valkey')) {
    return { layer: 'deterministic-capture', dtmfConfirm: true };
  }
  return { layer: 'reprompt-then-capture', reprompted: false };
}

/** STT reprompt consumed: the second failure captures instead of asking again. */
export function afterReprompt(answer: FallbackAnswer): FallbackAnswer {
  if (answer.layer === 'reprompt-then-capture' && !answer.reprompted) {
    return { layer: 'reprompt-then-capture', reprompted: true };
  }
  if (answer.layer === 'reprompt-then-capture') {
    return { layer: 'deterministic-capture', dtmfConfirm: true };
  }
  return answer;
}
