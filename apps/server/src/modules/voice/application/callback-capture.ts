/**
 * Callback capture (P12.09.01, filed per agy mapping under the callback
 * slice; INV-06/19).
 *
 * Caller requests callback → capture the number via DTMF/speech → confirm
 * with read-back → create the callback task via the tool guard with the
 * CallSid idempotency key. Pure turn logic here; the task write rides the
 * guard path separately. No turn ends without an outcome.
 */

export type CallbackStep =
  | { readonly step: 'ask-number' }
  | { readonly step: 'confirm-number'; readonly number: string }
  | { readonly step: 'captured'; readonly number: string }
  | { readonly step: 'escalate'; readonly reason: 'unintelligible-number' };

/** Read-back confirmation line (German, with the spaced digits). */
export function readBackNumber(number: string): string {
  return `Ich habe verstanden: ${number.split('').join(' ')}. Ist das korrekt?`;
}

export function captureTurn(heard: string | null, attempts: number): CallbackStep {
  if (heard === null || heard.trim() === '') {
    return attempts >= 2
      ? { step: 'escalate', reason: 'unintelligible-number' }
      : { step: 'ask-number' };
  }
  const digits = heard.replace(/\D/g, '');
  if (digits.length < 6) {
    return attempts >= 2
      ? { step: 'escalate', reason: 'unintelligible-number' }
      : { step: 'ask-number' };
  }
  return { step: 'confirm-number', number: digits };
}

export function confirmTurn(confirmed: boolean, number: string): CallbackStep {
  if (confirmed) return { step: 'captured', number };
  return { step: 'ask-number' };
}
