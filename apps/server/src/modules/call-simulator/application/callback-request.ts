/**
 * What a simulated caller asked for, decided deterministically (P12.09.01, M1 vertical slice).
 *
 * The slice handles one intent: "please call me back". The utterance is normalised (Unicode NFC,
 * control characters removed, whitespace collapsed), recognised by fixed German phrases — no
 * model, no guess — and summarised into the task title, by the first rule that applies:
 *
 *  1. the topic the caller named after "wegen": "Rückruf: <topic>" (the M1 behaviour, unchanged);
 *  2. a reservation or birthday request, from a fixed vocabulary, with only the details that are
 *     stated exactly once and without hedging: "Rückruf: Reservierung für 6 Personen am Freitag";
 *  3. otherwise "Rückruf erbeten".
 *
 * Rule 2 never copies the caller's words: the title is a template filled with a topic word, a
 * guest count (1..99) and one weekday or month, each taken from a closed list or validated as a
 * number. A request for a callback is not a booking, so the title never says "reserviert" or
 * "bestätigt"; a negation or cancellation ("nicht", "kein", "stornieren", "absagen"), a change, doubt or alternative ("verschieben", "vielleicht", "oder") or an existing booking ("bereits", "bestätigt") makes it
 * ambiguous and falls back to rule 3. Anything that is not a callback request is unsupported and
 * creates nothing; the real conversation flows (P12) own every other intent. The raw utterance is
 * never stored (INV-07, INV-12). Pure, no I/O.
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

// Rule 2 vocabulary. Every pattern is linear (no nested quantifier) and runs on input already capped
// at UTTERANCE_MAX_LENGTH characters. `\b` is ASCII-only, so boundaries use lookarounds on \p{L}.
const RESERVATION = /reservier\p{L}*|tischbuchung|tisch\s+buchen/iu;
const BIRTHDAY = /(?<!\p{L})geburtstag(?:sfeier|sessen|sparty)?(?!\p{L})/iu;
// Anything that makes the request a negation, a cancellation, a change, a doubt, an alternative or
// an existing booking: the title then stays neutral rather than state something that may be untrue.
const AMBIGUOUS =
  /(?<!\p{L})(?:nicht|kein\p{L}*|nie|niemals|ohne|storn\p{L}*|absag\p{L}*|abbestell\p{L}*|verschieb\p{L}*|umbuch\p{L}*|änder\p{L}*|statt|anstatt|ob|vielleicht|eventuell|eher|falls|oder|schon|bereits|bestätig\p{L}*)(?!\p{L})/iu;

// "für sechs Personen", "für 4 Gäste": exact counts only. "für etwa sechs", "ca. 6" do not match.
const GUESTS =
  /(?<!\p{L})für\s+(\d{1,2}|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(?:person(?:en)?|gäste|gast)(?!\p{L})/giu;
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  eine: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
};
const MAX_GUESTS = 99;

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const WEEKDAY = new RegExp(
  `(?<!\\p{L})(${WEEKDAYS.join('|')})(?:abend|mittag|morgen|vormittag|nachmittag)?(?!\\p{L})`,
  'giu',
);
// A weekday or month that belongs to the callback ("bis Freitag", "rufen Sie mich Freitag zurück",
// "zurück am Montag") is not the date of the booking, so it is not reported as one.
const DAY_PART = '(?:abend|mittag|morgen|vormittag|nachmittag)?';
const CALLBACK_WORD = '(?:zurück|rückruf)\\p{L}*';
const CALLBACK_TIME = new RegExp(
  `(?<!\\p{L})(?:bis|ab|vor|nach|bevor|spätestens|seit)\\s+(?:(?:dem|den|zum)\\s+)?(?:${WEEKDAYS.join('|')}|${MONTHS.join('|')})(?!\\p{L})` +
    `|(?:${WEEKDAYS.join('|')})${DAY_PART}(?:\\s+\\p{L}+){0,2}\\s+${CALLBACK_WORD}` +
    `|${CALLBACK_WORD}(?:\\s+\\p{L}+){0,2}\\s+(?:${WEEKDAYS.join('|')})`,
  'iu',
);
const MONTH = new RegExp(`(?<!\\p{L})im\\s+(${MONTHS.join('|')})(?!\\p{L})`, 'giu');

/** The one distinct value of a pattern's first group, or undefined when absent or contradictory. */
function onlyMatch(text: string, pattern: RegExp): string | undefined {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern))
    found.add((match[1] ?? '').toLocaleLowerCase('de-DE'));
  const [value] = found;
  return found.size === 1 ? value : undefined;
}

function canonical(list: readonly string[], lowered: string | undefined): string | undefined {
  return list.find((name) => name.toLocaleLowerCase('de-DE') === lowered);
}

/** Guests, only when every mention agrees (4 and "vier" agree) and the count is between 1 and 99. */
function guestCount(text: string): number | undefined {
  const counts = new Set<number>();
  for (const match of text.matchAll(GUESTS)) {
    const raw = (match[1] ?? '').toLocaleLowerCase('de-DE');
    counts.add(NUMBER_WORDS[raw] ?? Number(raw));
  }
  const [count] = counts;
  return counts.size === 1 && count !== undefined && count >= 1 && count <= MAX_GUESTS
    ? count
    : undefined;
}

/** "am Freitag" or "im Dezember": a stated weekday wins over a stated month; never inferred. */
function when(text: string): string | undefined {
  if (CALLBACK_TIME.test(text)) return undefined;
  const day = canonical(WEEKDAYS, onlyMatch(text, WEEKDAY));
  if (day !== undefined) return `am ${day}`;
  const month = canonical(MONTHS, onlyMatch(text, MONTH));
  return month === undefined ? undefined : `im ${month}`;
}

/** Rule 2: a template over a closed vocabulary, or undefined when nothing is safely recognised. */
function reservationTitle(utterance: string): string | undefined {
  const reservation = RESERVATION.test(utterance);
  const birthday = BIRTHDAY.test(utterance);
  if ((!reservation && !birthday) || AMBIGUOUS.test(utterance)) return undefined;
  const topic =
    reservation && birthday
      ? 'Reservierung für Geburtstagsfeier'
      : birthday
        ? 'Geburtstagsfeier'
        : 'Reservierung';
  const guests = guestCount(utterance);
  const people =
    guests === undefined ? '' : ` für ${String(guests)} ${guests === 1 ? 'Person' : 'Personen'}`;
  const day = when(utterance);
  return `Rückruf: ${topic}${people}${day === undefined ? '' : ` ${day}`}`;
}

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
    const summary = reservationTitle(utterance);
    return {
      kind: 'callback',
      title:
        summary === undefined ? GENERIC_CALLBACK_TITLE : truncate(summary, TASK_TITLE_MAX_LENGTH),
    };
  }
  const named = topic.charAt(0).toLocaleUpperCase('de-DE') + topic.slice(1);
  return { kind: 'callback', title: truncate(`Rückruf: ${named}`, TASK_TITLE_MAX_LENGTH) };
}
