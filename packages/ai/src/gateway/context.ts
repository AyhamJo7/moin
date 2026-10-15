/**
 * PII minimisation and redaction (P10.05, INV-12, ADR-0019).
 *
 * Two halves:
 * - Builders (`buildNluMessages`): the NLU step gets the transcript plus
 *   *slot names*, never slot values and never the caller number — the input
 *   type has no field for either, so a leak is a type error, not a review
 *   catch.
 * - `redactProposedOutput`: stored `proposed_output` with phones masked and
 *   names initialised. `containsPii` is the scanner the tests (P10.05.03)
 *   run over stored records.
 *
 * Name coverage is deliberately narrow (salutations and `Name:` labels):
 * bare-name detection in free German text is a NER model, not a regex, and
 * a regex that pretends otherwise initialises "Montag Morgen". Anything the
 * scanner still finds is a signal to tighten the template, not the regex.
 */

import type { GatewayMessage } from './port.ts';

/** Everything the NLU step may see. No caller number, no slot values. */
export interface NluContext {
  readonly transcript: string;
  /** Slot names the turn may fill (`callback_phone`), not their values. */
  readonly slotNames: readonly string[];
}

export function buildNluMessages(context: NluContext): readonly GatewayMessage[] {
  const slots =
    context.slotNames.length > 0 ? ` Mögliche Slots: ${context.slotNames.join(', ')}.` : '';
  return [
    {
      role: 'system',
      content: `Extrahiere Absicht und Slots aus dem Anruftext. Antworte nur im vorgegebenen Schema.${slots}`,
    },
    { role: 'user', content: context.transcript },
  ];
}

const PHONE = /\+?\d[\d\s./-]{5,}\d/g;
const SALUTATION = /\b(Herr|Frau)\s+([A-ZÄÖÜ][a-zäöüß]+)/g;
const LABELLED_NAME = /\b(Name|Anrufer):\s*([A-ZÄÖÜ][a-zäöüß]+)\s+([A-ZÄÖÜ][a-zäöüß]+)/g;

/** Mask phones, initialise salutation/labelled names in stored output. */
export function redactProposedOutput(text: string): string {
  return text
    .replace(PHONE, '[phone]')
    .replace(SALUTATION, (_m, sal: string, name: string) => `${sal} ${name.charAt(0)}.`)
    .replace(
      LABELLED_NAME,
      (_m, label: string, first: string, last: string) =>
        `${label}: ${first.charAt(0)}. ${last.charAt(0)}.`,
    );
}

/** True when raw PII patterns remain — run over stored records (P10.05.03). */
export function containsPii(text: string): boolean {
  // Reset lastIndex: module-level /g regexes are stateful.
  for (const re of [PHONE, SALUTATION, LABELLED_NAME]) re.lastIndex = 0;
  return PHONE.test(text) || SALUTATION.test(text) || LABELLED_NAME.test(text);
}
