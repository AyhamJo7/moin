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
 * duplicated or reopened; and one whose words are now judged unsupported (a refusal) is answered 422 at
 * the interpretation step, before the acceptance is consulted. Pure, no I/O. Every pattern is linear and runs on input already capped at
 * UTTERANCE_MAX_LENGTH characters.
 */

import { TASK_TITLE_MAX_LENGTH, UTTERANCE_MAX_LENGTH } from '@moin/contracts';

export const GENERIC_CALLBACK_TITLE = 'Rückruf erbeten';

export type CallInterpretation =
  | { readonly kind: 'callback'; readonly title: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'invalid' };

// "Rückruf", "zurückrufen", "zurückruft", "ruf(en Sie) mich bitte zurück".
const CALLBACK_PHRASE = /rückruf|zurückruf|zurückzuruf|\bruf\p{L}*\s+(?:\p{L}+\s+){0,3}zurück\b/iu;

// A clear refusal of the callback itself, in bounded forms: "nicht (mehr) zurückrufen", "nie
// zurückrufen", "auf keinen Fall zurückrufen", "rufen Sie mich nicht zurück", "keinen Rückruf",
// "Rückruf nicht erwünscht". The negation must sit next to the callback word: "nicht online buchen,
// bitte rufen Sie mich zurück" is not a refusal. Contradicting instructions are refused as well: the
// caller can ask again, an unwanted contact cannot be taken back.
const NEGATION =
  '(?:nicht|nie|niemals|keinesfalls|keineswegs|auf\\s+keinen\\s+fall|unter\\s+keinen\\s+umständen)';
// Only these words may sit between the negation and the callback word, so "nicht erst morgen zurück",
// "nicht zu spät zurück" and "nicht vor Montag zurück" stay callbacks.
const NEGATION_FILLER = '(?:\\s+(?:mehr|bitte|wieder|noch|nochmal|nochmals|doch|lieber|besser))*';
// A word that is not itself a negation: "vergessen Sie nicht den Rückruf" asks for the callback.
const PLAIN_WORD = '(?:\\s+(?!nicht(?!\\p{L}))\\p{L}+)';
const REFUSAL = [
  new RegExp(`(?<!\\p{L})${NEGATION}${NEGATION_FILLER}\\s+zurück(?:ruf|rufen)?(?!\\p{L})`, 'iu'),
  // "bitte nicht mehr anrufen", "rufen Sie mich nicht an" (ending the clause: "nicht anrufen vor 10" is a time).
  new RegExp(
    `(?<!\\p{L})${NEGATION}${NEGATION_FILLER}\\s+(?:anrufen|anruf|kontaktieren|belästigen)(?!\\p{L})(?=\\s*(?:[.!?;,:]|$))`,
    'iu',
  ),
  new RegExp(
    `\\bruf\\p{L}*${PLAIN_WORD}{0,2}\\s+${NEGATION}${NEGATION_FILLER}\\s+an(?!\\p{L})(?=\\s*(?:[.!?;,:]|$))`,
    'iu',
  ),
  /(?<!\p{L})kein(?:en|e)?\s+(?:(?:weiteren|erneuten|weitere)\s+)?(?:(?:zurück)?rückruf|zurückruf|anruf)(?!\p{L})(?!\s+(?:vor|bis|nach|ab|am|im|um|zwischen|auf|über|während|morgens?|abends|nachts|mittags|per|via|nur|außer)(?!\p{L}))/iu,
  /(?<!\p{L})ohne\s+rückruf/iu,
  // "Rückruf (bitte) nicht / nie / auf keinen Fall / nicht erwünscht / unerwünscht / nein danke /
  // erübrigt sich", ending the clause: "Rückruf bitte nicht zu spät" is a callback.
  new RegExp(
    `rückruf\\p{L}*(?:\\s+bitte)?[\\s:,.?!-]+(?:bitte\\s+)?(?:ist\\s+)?(?:(?:doch|lieber|besser|eher)\\s+)?(?:${NEGATION}(?:\\s+(?:mehr|nötig|erforderlich|notwendig|erwünscht|gewünscht|gewollt|erlaubt))*|unnötig|überflüssig|unerwünscht|verboten|nein(?:\\s+danke)?|entfällt|erübrigt\\s+sich|(?:hat\\s+sich\\s+)?erledigt)(?=\\s*(?:[.!?;,:]|$))`,
    'iu',
  ),
  // "Ich möchte nicht, dass Sie mich zurückrufen", "Ich rufe Sie später zurück" (the caller calls, nobody has work).
  /(?<!\p{L})nicht,?\s+dass\s+(?:(?!(?:zu|spät|später|erst|vor|nach|früh)(?!\p{L}))\p{L}+\s+){0,3}zurückruf/iu,
  /(?<!\p{L})ich\s+ruf\p{L}*\s+(?:sie|euch)\s+(?:\p{L}+\s+){0,2}zurück/iu,
  /(?<!\p{L})weder\s+(?:zurück)?rückruf/iu,
  // "Rückruf brauche ich nicht", "Ein Rückruf wird nicht benötigt", "kommt nicht in Frage", "keinen Wert", "sein lassen".
  new RegExp(
    `rückruf\\p{L}*${PLAIN_WORD}{0,5}\\s+(?:nicht(?:\\s+(?:benötigt|sein|in\\s+frage))?|in\\s+frage)(?=\\s*(?:[.!?;,:]|$))|rückruf\\p{L}*${PLAIN_WORD}{0,3}\\s+keinen\\s+wert|lass\\p{L}*${PLAIN_WORD}{0,3}\\s+rückruf${PLAIN_WORD}{0,2}\\s+sein(?!\\p{L})`,
    'iu',
  ),
  // "unterlassen Sie den Rückruf", "vergessen Sie den Rückruf", "Rückruf vermeiden".
  new RegExp(
    `(?<!\\p{L})(?:unterlass|vermeid|verbiet|stornier|abbestell|absag|vergess|vergiss|verzicht|widerruf)\\p{L}*${PLAIN_WORD}{0,3}\\s+(?:zurück)?rückruf`,
    'iu',
  ),
  new RegExp(
    `rückruf\\p{L}*${PLAIN_WORD}{0,4}\\s+(?:unterlass|vermeid|verbiet|vergess|vergiss|verzicht)\\p{L}*`,
    'iu',
  ),
];

// The topic vocabulary.
const RESERVATION = /reservier\p{L}*|tischbuchung|tisch\s+buchen/iu;
const TABLE_RESERVATION = /tischreservierung/iu;
// A celebration is named as one ("Geburtstagsfeier", "-essen", "-party"); a bare "Geburtstag" counts
// only beside a reservation or the word "feiern", so "Geburtstagsgeschenk" and "Geburtstag meiner
// Mutter" are not announced as a party.
const BIRTHDAY_CELEBRATION = /(?<!\p{L})geburtstag(?:sfeier|sessen|sparty)(?!\p{L})/iu;
const BIRTHDAY_BARE = /(?<!\p{L})geburtstags?(?!\p{L})/iu;
const CELEBRATE = /(?<!\p{L})(?:feier|feiern|feiere)(?!\p{L})/iu;

// The request itself is negated, cancelled, changed, doubted, or already booked: the title stays
// neutral rather than state something that may be untrue.
const TOPIC_UNCERTAIN =
  /(?<!\p{L})(?:nicht|kein\p{L}*|nie|niemals|ohne|storn\p{L}*|absag\p{L}*|abbestell\p{L}*|verschieb\p{L}*|umbuch\p{L}*|änder\p{L}*|statt|anstatt|ob|vielleicht|eventuell|eher|falls|schon|bereits|bestätig\p{L}*)(?!\p{L})|reservierungs\p{L}+/iu;

// An alternative or an approximation makes the details uncertain, not the topic.
const DETAIL_HEDGE =
  /(?<!\p{L})(?:oder|etwa|ungefähr|circa|zirka|rund|mindestens|höchstens|über|mehr|weniger)(?!\p{L})|(?<!\p{L})(?:ca|evtl|ggf)\.?(?!\p{L})|(?<!\p{L})(?:gegebenenfalls|wahrscheinlich|voraussichtlich|möglicherweise|vermutlich|glaube|hoffentlich|soweit|sofern|unklar|unter\s+umständen|dazu|sondern|nein|weil|war|waren|wurde|wurden|gewesen|letzte\p{L}*|vergangen\p{L}*|gestern|erhöh\p{L}*|reduzier\p{L}*|verringer\p{L}*|prüf\p{L}*|verlänger\p{L}*)(?!\p{L})/iu;

// Guest counts. Every "<number> Personen" mention is read, supported or not, so that an unsupported
// or contradicting count makes the whole detail uncertain instead of being skipped. A chain such as
// "6–8", "fünfzehn bis 20", "5 oder 6" or "zwischen 6 und 8" is captured whole, whatever the words before the
// connector are (a number this interpreter does not know is still an endpoint): it is a range, never the
// number at its end.
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
const RANGE_CONNECTOR =
  '(?:\\s*[–—\\-/+]\\s*|\\s+(?:bis|oder|und|zu|plus|bzw\\.?|beziehungsweise)\\s+)';
const GUEST_MENTION = new RegExp(
  `(?<![\\p{L}\\d])(?:(für|mit)\\s+)?((?:[\\p{L}\\d]+${RANGE_CONNECTOR})*[\\p{L}\\d]+)\\s+(?:person(?:en)?|gäste|gast|leute)(?!\\p{L})`,
  'giu',
);
// An approximation or bound right before or after a count: the count is not exact.
const COUNT_HEDGE_BEFORE =
  /(?:bis\s+zu|zwischen|maximal|max\.?|mind\.?|mindestens|höchstens|etwa|circa|ca\.?|ungefähr|rund|knapp|gut|über|unter|mehr\s+als|weniger\s+als|wohl|vielleicht|schätzungsweise|plus|\+)\s*$/iu;
const COUNT_HEDGE_AFTER =
  /^\s*(?:\+|plus|oder|bzw|maximal|max|mindestens|etwa|circa|ca|ungefähr|rund|knapp|vielleicht|schätzungsweise|und\s+mehr)(?!\p{L})/iu;
// Any further number in a clause that is not about the callback ("7 sind möglich", "nein 5") may restate the count.
const OTHER_NUMBER = new RegExp(
  `\\d|(?<!\\p{L})(?:${Object.keys(NUMBER_WORDS)
    .filter((w) => w !== 'eine')
    .join('|')})(?!\\p{L})`,
  'iu',
);
const MAX_GUESTS = 99;
// Other words that give a head count: the total may not be the number that was read.
const OTHER_GUESTS =
  /(?<!\p{L})(?:kind\p{L}*|erwachsene\p{L}*|babys?|zu\s+(?:zweit|dritt|viert|fünft|sechst))(?!\p{L})/iu;

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
const ORDINAL_DATE = new RegExp(`\\d{1,2}\\.\\s*(?=(?:${MONTHS.join('|')})(?!\\p{L}))`, 'giu');
const DAY_PART = '(?:abend|mittag|morgen|vormittag|nachmittag)?';
const WEEKDAY = new RegExp(`(?<!\\p{L})(${WEEKDAYS.join('|')})${DAY_PART}(?!\\p{L})`, 'giu');
const MONTH = new RegExp(`(?<!\\p{L})im\\s+(${MONTHS.join('|')})(?!\\p{L})`, 'giu');
// "bis Freitag", "ab Montag", "nach dem Dezember": a limit or a start, not the day of the booking.
const LIMIT = new RegExp(
  `(?<!\\p{L})(?:bis|ab|vor|nach|bevor|spätestens|seit|außer|zwischen|vom|letzten|jeden|vergangenen)\\s+(?:(?:dem|den|zum|im)\\s+)?(?:${WEEKDAYS.join('|')}${DAY_PART}|${MONTHS.join('|')})(?!\\p{L})`,
  'iu',
);

// A word that makes a clause, or the words around a date, about the callback or the caller's own
// availability: the date there is when to call, not when to book.
const CALLBACK_WORD =
  /zurück|rückruf|(?<!\p{L})ruf(?:en|t|e)?(?!\p{L})|erreich\p{L}*|melde\p{L}*|anruf\p{L}*|telefon\p{L}*|sprech\p{L}*|kontakt\p{L}*|klär\p{L}*|besprech\p{L}*|diskutier\p{L}*|erkundig\p{L}*|nachfrag\p{L}*|informier\p{L}*|auskunft/iu;
// How many words on each side of a date are searched for a callback word.
const DATE_NEIGHBOURS = 4;

function canonical(list: readonly string[], lowered: string): string | undefined {
  return list.find((name) => name.toLocaleLowerCase('de-DE') === lowered);
}

/** The number a count word stands for; own properties only, so "constructor" is not a number. */
function numberOf(raw: string): number | undefined {
  if (/^\d+$/u.test(raw)) return Number(raw);
  return Object.hasOwn(NUMBER_WORDS, raw) ? NUMBER_WORDS[raw] : undefined;
}

const CLAUSE_BREAK = /[.!?;,:]+/u;

/** A bare "Geburtstag" is a celebration only beside a reservation or "feiern" in its own clause. */
function bareBirthday(clause: string): boolean {
  return BIRTHDAY_BARE.test(clause) && (RESERVATION.test(clause) || CELEBRATE.test(clause));
}

function firstTopic(clause: string): RegExpExecArray | undefined {
  const patterns = [RESERVATION, BIRTHDAY_CELEBRATION];
  if (bareBirthday(clause)) patterns.push(BIRTHDAY_BARE);
  return patterns
    .map((pattern) => pattern.exec(clause))
    .filter((match) => match !== null)
    .sort((a, b) => a.index - b.index)[0];
}

/** Guests: every count mention supported and agreeing, stated "für/mit N" in a booking clause. */
function guestCount(utterance: string): number | undefined {
  if (OTHER_GUESTS.test(utterance)) return undefined;
  const counts = new Set<number>();
  let stated = false;
  for (const clause of utterance.split(CLAUSE_BREAK)) {
    const inBooking = firstTopic(clause) !== undefined;
    for (const match of clause.matchAll(GUEST_MENTION)) {
      const value = numberOf((match[2] ?? '').toLocaleLowerCase('de-DE'));
      if (value === undefined) return undefined;
      const before = clause.slice(0, match.index);
      const after = clause.slice(match.index + match[0].length);
      if (COUNT_HEDGE_BEFORE.test(before) || COUNT_HEDGE_AFTER.test(after)) return undefined;
      counts.add(value);
      if (match[1] !== undefined && inBooking) stated = true;
    }
  }
  // An ordinal date ("12. Dezember") is a date, not a count, and its full stop is not a clause break.
  const withoutOrdinals = utterance.replace(ORDINAL_DATE, ' ');
  for (const clause of withoutOrdinals.split(CLAUSE_BREAK)) {
    if (CALLBACK_WORD.test(clause)) continue;
    const rest = clause.replace(GUEST_MENTION, ' ').replace(/\d+(?::\d+)?\s*uhr/giu, ' ');
    if (OTHER_NUMBER.test(rest)) return undefined;
  }
  const [count] = counts;
  return stated && counts.size === 1 && count !== undefined && count >= 1 && count <= MAX_GUESTS
    ? count
    : undefined;
}

const LIMIT_EVERYWHERE = new RegExp(LIMIT.source, 'giu');

// A date phrase the booking itself can carry: "für|am|auf|zum [dem|den] <weekday>" or "im <month>".
const DATE_PHRASE = `(?:(?:für|am|auf|zum)\\s+(?:(?:dem|den)\\s+)?(?:${WEEKDAYS.join('|')})${DAY_PART}|im\\s+(?:${MONTHS.join('|')}))(?!\\p{L})(?:\\s+im\\s+(?:${MONTHS.join('|')})(?!\\p{L}))?`;
const GUESTS_PHRASE = '(?:für|mit)\\s+[\\p{L}\\d]+\\s+(?:person(?:en)?|gäste|gast|leute)';
// Words that may stand between a date and the reservation verb: "für Samstag einen Tisch reservieren".
const VERB_FILLER = '(?:einen|eine|ein|den|die|unseren|unsere|meinen|meine|bitte|gerne|mal|tisch)';

const EXISTING_BOOKING =
  /(?<!\p{L})(?:habe|haben|hat|hatte|gebucht|bestätigt|bestehend\p{L}*|vorhanden|besteht|steht)(?!\p{L})/iu;
const POSSESSIVE = /(?<!\p{L})(?:meine\p{L}*|unsere\p{L}*|ihre\p{L}*|bestehende\p{L}*)\s*$/iu;
const DEFINITE = new RegExp(
  `(?<!\\p{L})(?:die|der|dem|den|diese\\p{L}*)\\s*$|${POSSESSIVE.source}`,
  'iu',
);
const DISCUSSING =
  /(?:telefon|sprech|reden|red|klär|frag|erkundig|informier|auskunft)\p{L}*|(?<!\p{L})über(?!\p{L})/iu;

// "für Freitag zwischen 10 und 12", "… gegen zehn Uhr", "… nach 15 Uhr": a window to call, not the booking.
const CALL_WINDOW = /^\s+(?:zwischen|gegen|nach|vor|ab|bis|um|ca|etwa)(?!\p{L})/iu;

interface DateMention {
  readonly index: number;
  readonly kind: 'day' | 'month';
  readonly name: string;
}

function dateMentions(clause: string): DateMention[] {
  const days = [...clause.matchAll(WEEKDAY)].map((m): DateMention => ({
    index: m.index,
    kind: 'day',
    name: (m[1] ?? '').toLocaleLowerCase('de-DE'),
  }));
  const months = [...clause.matchAll(MONTH)].map((m): DateMention => ({
    index: m.index,
    kind: 'month',
    name: (m[1] ?? '').toLocaleLowerCase('de-DE'),
  }));
  return [...days, ...months];
}

/** The words next to a date (before: ending at `start`, after: beginning at `end`) hold a callback word. */
function callbackNear(clause: string, start: number, end: number): boolean {
  const before = clause.slice(0, start).trim().split(/\s+/u).slice(-DATE_NEIGHBOURS).join(' ');
  const after = clause.slice(end).trim().split(/\s+/u).slice(0, DATE_NEIGHBOURS).join(' ');
  return CALLBACK_WORD.test(before) || CALLBACK_WORD.test(after);
}

/** The spans of the date phrases that the booking itself carries, in one clause. */
function bookingDateSpans(clause: string): (readonly [number, number])[] {
  const topic = bareBirthday(clause) ? '|geburtstags?' : '';
  const topics = `(?:\\p{L}*reservier\\p{L}*|tischbuchung|tisch\\s+buchen|(?<!\\p{L})geburtstag(?:sfeier|sessen|sparty)${topic})(?!\\p{L})`;
  const spans: (readonly [number, number])[] = [];
  // A new reservation or celebration is requested, not discussed, owned or already booked. A noun alone
  // is not enough: a definite article or possessive ("die", "unsere"), a verb of discussing before it,
  // or a word of an existing booking in the clause ("habe", "gebucht") means the date is unattributable.
  const existing = EXISTING_BOOKING.test(clause);
  // The date follows an indefinite or bare topic noun ("Reservierung für 6 Personen am Freitag"). A
  // callback word right after the date ("Reservierung am Freitag zurückrufen") may make it the callback's.
  const after = new RegExp(`${topics}\\s+(?:${GUESTS_PHRASE}\\s+)?(${DATE_PHRASE})`, 'giu');
  for (const m of clause.matchAll(after)) {
    const date = m[1] ?? '';
    const end = m.index + m[0].length;
    // A celebration is intended to happen even when called "die Geburtstagsfeier"; a reservation noun is not.
    const birthday = /^geburtstag/iu.test(m[0]);
    const lead = clause.slice(0, m.index).trim().split(/\s+/u);
    if (
      !existing &&
      (!CALLBACK_WORD.test(clause) ||
        (/^für/iu.test(date) && !CALL_WINDOW.test(clause.slice(end)))) &&
      !(birthday ? POSSESSIVE : DEFINITE).test(lead.slice(-2).join(' ')) &&
      !DISCUSSING.test(lead.slice(-3).join(' ')) &&
      !callbackNear(clause, end, end)
    ) {
      spans.push([end - date.length, end]);
    }
  }
  // The date comes before the verb "reservieren" ("für Samstag einen Tisch reservieren"); the noun
  // "Reservierung" after a date ("am Freitag die Reservierung besprechen") says nothing about the date.
  const before = new RegExp(
    `(?:${GUESTS_PHRASE}\\s+)?(${DATE_PHRASE})(?:\\s+${GUESTS_PHRASE})?(?:\\s+${VERB_FILLER})*\\s+reservieren(?!\\p{L})`,
    'giu',
  );
  for (const m of clause.matchAll(before)) {
    const date = m[1] ?? '';
    const start = m.index + m[0].indexOf(date);
    if (!existing) spans.push([start, start + date.length]);
  }
  return spans;
}

/**
 * "am Freitag" or "im Dezember", only when a date is tied to the reservation or the celebration
 * itself. Every date mention in the call is given one role: the booking's (it sits in a supported
 * phrase with the topic and no callback word beside it), the callback's (it sits in a callback
 * clause, or beside a callback word), or unknown. One booking date and no unknown date that differs
 * from it, else no date: omitting is always safe, guessing is not.
 */
function when(utterance: string): string | undefined {
  const booking = { days: new Set<string>(), months: new Set<string>() };
  const unknown = { days: new Set<string>(), months: new Set<string>() };
  for (const clause of utterance.split(CLAUSE_BREAK)) {
    const hasTopic = firstTopic(clause) !== undefined;
    const aboutCallback = CALLBACK_WORD.test(clause);
    const spans = hasTopic ? bookingDateSpans(clause) : [];
    const limits = [...clause.matchAll(LIMIT_EVERYWHERE)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    for (const mention of dateMentions(clause)) {
      const inside = (list: readonly (readonly number[])[]): boolean =>
        list.some(([from = 0, to = 0]) => mention.index >= from && mention.index < to);
      const bucket = mention.kind === 'day' ? 'days' : 'months';
      if (inside(limits)) {
        // "bis Freitag": a limit. Beside the callback it is the callback's; elsewhere it cannot be placed.
        if (!aboutCallback) return undefined;
        continue;
      }
      if (inside(spans)) {
        booking[bucket].add(mention.name);
      } else if (
        aboutCallback &&
        (!hasTopic || callbackNear(clause, mention.index, mention.index + mention.name.length))
      ) {
        continue;
      } else {
        unknown[bucket].add(mention.name);
      }
    }
  }
  const conflicting = (a: Set<string>, b: Set<string>): boolean =>
    [...b].some((value) => !a.has(value));
  if (
    booking.days.size > 1 ||
    booking.months.size > 1 ||
    conflicting(booking.days, unknown.days) ||
    conflicting(booking.months, unknown.months)
  ) {
    return undefined;
  }
  const day = canonical(WEEKDAYS, [...booking.days][0] ?? '');
  if (day !== undefined) return `am ${day}`;
  const month = canonical(MONTHS, [...booking.months][0] ?? '');
  return month === undefined ? undefined : `im ${month}`;
}

/** The title for a recognised topic, or undefined when the request is not safely about one. */
function topicTitle(utterance: string): string | undefined {
  const reservation = RESERVATION.test(utterance);
  const birthday =
    BIRTHDAY_CELEBRATION.test(utterance) || utterance.split(CLAUSE_BREAK).some(bareBirthday);
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
