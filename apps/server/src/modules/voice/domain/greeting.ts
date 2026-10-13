/**
 * Call greeting (P12.01, INV-03, LG-V01).
 *
 * The greeting is the disclosure plus the intent opening, in that order:
 * the business name, the AI statement, the no-recording statement, the
 * human way out — then "Womit kann ich Ihnen helfen?". The disclosure
 * comes from `buildDisclosure` (fixed template, name is the only variable);
 * this module owns the composition and the order pins: disclosure first,
 * always, never interrupted, never skipped.
 */

import { buildDisclosure } from './disclosure.ts';

export const GREETING_OPENING = 'Womit kann ich Ihnen helfen?' as const;

/** Full greeting: disclosure spoken first, then the intent opening. */
export function buildGreeting(businessName: string): string {
  return `${buildDisclosure(businessName)} ${GREETING_OPENING}`;
}

/** True when the greeting starts with the disclosure and ends with the opening. */
export function isValidGreeting(greeting: string, businessName: string): boolean {
  const disclosure = buildDisclosure(businessName);
  return greeting.startsWith(disclosure) && greeting.endsWith(GREETING_OPENING);
}
