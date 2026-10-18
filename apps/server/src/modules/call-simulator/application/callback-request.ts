/**
 * What a simulated caller asked for, decided deterministically (P12.09.01, M1 vertical slice).
 *
 * The slice handles one intent: "please call me back". The utterance is normalised (Unicode NFC,
 * control characters removed, whitespace collapsed) and recognised by fixed German phrases: no
 * model, no guess. Three outcomes:
 *
 *  - unsupported: not a callback request, or a clear refusal of one ("bitte nicht zurückrufen",
 *    "keinen Rückruf"). Nothing is created; the HTTP boundary answers 422 before any write.
 *  - invalid: empty, or longer than the contract allows.
 *  - callback, with a title built only from a closed grammar (never from the caller's words):
 *
 *      Rückruf erbeten
 *      Rückruf: <Tischreservierung | Reservierung | Geburtstagsfeier | Reservierung für Geburtstagsfeier>
 *               [ für N Personen] [ am <Wochentag> | im <Monat>]
 *
 *    The topic words come from a fixed vocabulary; N is a number from 1 to 99; the weekday and the
 *    month come from fixed lists. Whatever else the caller said (names, numbers, health or
 *    financial remarks, markup) cannot reach the title, because nothing is copied: it is filled
 *    from validated values only. A detail is stated only when the evidence is unambiguous: a count
 *    only if every count mention agrees, a date only if it sits in the booking's own clause and no
 *    other date contradicts it, and neither when a hedge ("etwa", "mindestens", "oder") is present.
 *    A negation, cancellation, change, doubt or existing booking ("nicht", "stornieren",
 *    "verschieben", "vielleicht", "bereits") leaves the neutral title. A callback request is not a
 *    booking, so the title never says reserved or confirmed.
 *
 * The raw utterance is never stored (INV-07, INV-12). The title takes part in the request hash of
 * the call's acceptance (`callback-intake.ts`), so a call accepted under an earlier version of these
 * rules and delivered again with the same words may be refused as a conflicting request (409), never
 * duplicated or reopened. Pure, no I/O. Every pattern is linear and runs on input already capped at
 * UTTERANCE_MAX_LENGTH characters.
 */

import { TASK_TITLE_MAX_LENGTH, UTTERANCE_MAX_LENGTH } from '@moin/contracts';

export const GENERIC_CALLBACK_TITLE = 'Rückruf erbeten';

export type CallInterpretation =
  | { readonly kind: 'callback'; readonly title: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'invalid' };

// "Rückruf", "zurückrufen", "zurückruft", "ruf(en Sie) mich bitte zurück".
const CALLBACK_PHRASE = /rückruf|zurückruf|\bruf\p{L}*\s+(?:\p{L}+\s+){0,3}zurück\b/iu;

// A clear refusal of the callback itself, in bounded forms: "nicht (mehr) zurückrufen", "rufen Sie
// mich nicht zurück", "keinen Rückruf", "ohne Rückruf", "Rückruf nicht nötig". The negation must sit
// next to the callback word: "nicht online buchen, bitte rufen Sie mich zurück" is not a refusal.
const REFUSAL = [
  /(?<!\p{L})nicht(?:\s+\p{L}+){0,2}\s+zurück/iu,
  /(?<!\p{L})kein\p{L}*(?:\s+\p{L}+)?\s+rückruf/iu,
  /(?<!\p{L})ohne\s+rückruf/iu,
  /rückruf\s+(?:ist\s+)?(?:nicht|unnötig|überflüssig)(?!\p{L})/iu,
];

// The topic vocabulary.
const RESERVATION = /reservier\p{L}*|tischbuchung|tisch\s+buchen/iu;
const TABLE_RESERVATION = /tischreservierung/iu;
const BIRTHDAY = /(?<!\p{L})geburtstag(?:sfeier|sessen|sparty)?(?!\p{L})/iu;

// The request itself is negated, cancelled, changed, doubted, or already booked: the title stays
// neutral rather than state something that may be untrue.
const TOPIC_UNCERTAIN =
  /(?<!\p{L})(?:nicht|kein\p{L}*|nie|niemals|ohne|storn\p{L}*|absag\p{L}*|abbestell\p{L}*|verschieb\p{L}*|umbuch\p{L}*|änder\p{L}*|statt|anstatt|ob|vielleicht|eventuell|eher|falls|schon|bereits|bestätig\p{L}*)(?!\p{L})/iu;

// An alternative or an approximation makes the details uncertain, not the topic.
const DETAIL_HEDGE =
  /(?<!\p{L})(?:oder|etwa|ungefähr|circa|zirka|rund|mindestens|höchstens|über|mehr|weniger)(?!\p{L})|(?<!\p{L})ca\.?(?!\p{L})/iu;

// Guest counts. Every "<word> Personen" mention is read, supported or not, so that an unsupported
// or contradicting count makes the whole detail uncertain instead of being skipped.
const GUEST_MENTION =
  /(?<![\p{L}\d])(?:(für|mit)\s+)?([\p{L}\d]+)\s+(?:person(?:en)?|gäste|gast|leute)(?!\p{L})/giu;
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
const DAY_PART = '(?:abend|mittag|morgen|vormittag|nachmittag)?';
const WEEKDAY = new RegExp(`(?<!\\p{L})(${WEEKDAYS.join('|')})${DAY_PART}(?!\\p{L})`, 'giu');
const MONTH = new RegExp(`(?<!\\p{L})im\\s+(${MONTHS.join('|')})(?!\\p{L})`, 'giu');
// "bis Freitag", "ab Montag", "nach dem Dezember": a limit or a start, not the day of the booking.
const LIMIT = new RegExp(
  `(?<!\\p{L})(?:bis|ab|vor|nach|bevor|spätestens|seit)\\s+(?:(?:dem|den|zum|im)\\s+)?(?:${WEEKDAYS.join('|')}${DAY_PART}|${MONTHS.join('|')})(?!\\p{L})`,
  'giu',
);

// A clause that is about the callback itself: its dates are the callback's, not the booking's.
const CALLBACK_CLAUSE = /zurück|rückruf|(?<!\p{L})ruf(?:en|t|e)?(?!\p{L})/iu;

function canonical(list: readonly string[], lowered: string): string | undefined {
  return list.find((name) => name.toLocaleLowerCase('de-DE') === lowered);
}

/** Guests: only when every count mention is supported and agrees, and the count is stated "für N". */
function guestCount(text: string): number | undefined {
  const counts = new Set<number>();
  let stated = false;
  for (const match of text.matchAll(GUEST_MENTION)) {
    const raw = (match[2] ?? '').toLocaleLowerCase('de-DE');
    const value = /^\d+$/u.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (value === undefined) return undefined;
    counts.add(value);
    if (match[1] !== undefined) stated = true;
  }
  const [count] = counts;
  return stated && counts.size === 1 && count !== undefined && count >= 1 && count <= MAX_GUESTS
    ? count
    : undefined;
}

/**
 * The parts of the utterance whose dates may belong to the booking: a clause that names the topic
 * and is not about the callback, whole; in a clause that is both ("rufen Sie mich zurück wegen
 * einer Tischreservierung für Samstag"), only the few words that follow the topic word.
 */
function bookingSegments(utterance: string): string[] {
  const segments: string[] = [];
  for (const clause of utterance.split(/[.!?;,:]+/u)) {
    const topic = [RESERVATION, BIRTHDAY]
      .map((pattern) => pattern.exec(clause))
      .filter((match) => match !== null)
      .sort((a, b) => a.index - b.index)[0];
    if (topic === undefined) continue;
    segments.push(
      CALLBACK_CLAUSE.test(clause)
        ? clause.slice(topic.index).split(/\s+/u).slice(0, 4).join(' ')
        : clause,
    );
  }
  return segments;
}

/** "am Freitag" or "im Dezember", only when the booking's own clauses agree; never inferred. */
function when(utterance: string): string | undefined {
  const days = new Set<string>();
  const months = new Set<string>();
  for (const segment of bookingSegments(utterance)) {
    const text = segment.replace(LIMIT, ' ');
    for (const match of text.matchAll(WEEKDAY))
      days.add((match[1] ?? '').toLocaleLowerCase('de-DE'));
    for (const match of text.matchAll(MONTH))
      months.add((match[1] ?? '').toLocaleLowerCase('de-DE'));
  }
  if (days.size > 1 || months.size > 1) return undefined;
  const day = canonical(WEEKDAYS, [...days][0] ?? '');
  if (day !== undefined) return `am ${day}`;
  const month = canonical(MONTHS, [...months][0] ?? '');
  return month === undefined ? undefined : `im ${month}`;
}

/** The title for a recognised topic, or undefined when the request is not safely about one. */
function topicTitle(utterance: string): string | undefined {
  const reservation = RESERVATION.test(utterance);
  const birthday = BIRTHDAY.test(utterance);
  if ((!reservation && !birthday) || TOPIC_UNCERTAIN.test(utterance)) return undefined;
  const topic =
    reservation && birthday
      ? 'Reservierung für Geburtstagsfeier'
      : birthday
        ? 'Geburtstagsfeier'
        : TABLE_RESERVATION.test(utterance)
          ? 'Tischreservierung'
          : 'Reservierung';
  if (DETAIL_HEDGE.test(utterance)) return `Rückruf: ${topic}`;
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
  // A refusal wins over any positive wording in the same request: contact work nobody wants is the
  // worse mistake, and the caller can ask again.
  if (REFUSAL.some((pattern) => pattern.test(utterance))) return { kind: 'unsupported' };
  const summary = topicTitle(utterance);
  return {
    kind: 'callback',
    title:
      summary === undefined ? GENERIC_CALLBACK_TITLE : truncate(summary, TASK_TITLE_MAX_LENGTH),
  };
}
