/**
 * What a simulated caller asked for, decided deterministically (P12.09.01, M1 vertical slice).
 *
 * The slice handles one intent: "please call me back". The utterance is normalised (Unicode NFC,
 * control characters removed, whitespace collapsed), recognised by fixed German phrases — no
 * model, no guess — and summarised into the task title: "Rückruf: <topic>" when the caller named
 * one after "wegen", otherwise "Rückruf erbeten". Anything else is unsupported and creates
 * nothing; the real conversation flows (P12) own every other intent. Pure, no I/O.
 */

import { TASK_TITLE_MAX_LENGTH, UTTERANCE_MAX_LENGTH } from '@moin/contracts';

export const GENERIC_CALLBACK_TITLE = 'Rückruf erbeten';

export type CallInterpretation =
  | { readonly kind: 'callback'; readonly title: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'invalid' };

// "Rückruf", "zurückrufen", "zurückruft", "ruf(en Sie) mich bitte zurück".
const CALLBACK_PHRASE = /rückruf|zurückruf|\bruf\p{L}*\s+(?:\p{L}+\s+){0,3}zurück\b/iu;

// The topic after "wegen", without its article: "wegen einer Tischreservierung" → "Tischreservierung".
const TOPIC =
  /\bwegen\s+(?:(?:einer|eines|einem|einen|der|des|dem|den|meiner|meines|meinem|meinen|unserer|unseres|unserem|unseren)\s+)?([^.!?,;:]+)/iu;

/** NFC, control characters dropped, whitespace runs collapsed to one space, trimmed. */
export function normaliseUtterance(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

export function interpretCall(rawUtterance: string): CallInterpretation {
  const utterance = normaliseUtterance(rawUtterance);
  if (utterance.length === 0 || Array.from(utterance).length > UTTERANCE_MAX_LENGTH) {
    return { kind: 'invalid' };
  }
  if (!CALLBACK_PHRASE.test(utterance)) return { kind: 'unsupported' };
  const topic = TOPIC.exec(utterance)?.[1]?.trim();
  if (topic === undefined || topic.length === 0) {
    return { kind: 'callback', title: GENERIC_CALLBACK_TITLE };
  }
  const named = topic.charAt(0).toLocaleUpperCase('de-DE') + topic.slice(1);
  return { kind: 'callback', title: truncate(`Rückruf: ${named}`, TASK_TITLE_MAX_LENGTH) };
}
