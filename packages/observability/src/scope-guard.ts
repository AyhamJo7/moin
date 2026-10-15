/**
 * Scope guardrails (P16.13.01/.03): allowed business types and intent gate —
 * in-scope passes, denylisted intents refuse with a German message and route
 * to a human. Pure; the template loader and the review gate (P16.13.02 ADR
 * note) ride separately.
 */

/** In-scope business types for the pilot. */
const ALLOWED_BUSINESS: readonly string[] = ['restaurant', 'handwerk', 'praxis', 'handel'];

/** Denylisted intents: high-risk / excluded uses (INV-14). */
const DENYLISTED_INTENTS: readonly string[] = [
  'employment-decision',
  'credit-decision',
  'biometrics',
  'emotion-inference',
  'applicant-screening',
];

const DENY_SET = new Set(DENYLISTED_INTENTS);

/** German refusal message for out-of-scope requests. */
export const SCOPE_REFUSAL =
  'Das liegt außerhalb meines Aufgabenbereichs. Ich verbinde Sie mit einem Menschen.';

/** True when the business type is in scope. */
export function businessInScope(businessType: string): boolean {
  return ALLOWED_BUSINESS.includes(businessType);
}

/** True when the intent is denylisted and must refuse. */
export function intentDenied(intent: string): boolean {
  return DENY_SET.has(intent);
}

/** Gate: in-scope business + non-denylisted intent passes. */
export function scopePasses(businessType: string, intent: string): boolean {
  return businessInScope(businessType) && !intentDenied(intent);
}
