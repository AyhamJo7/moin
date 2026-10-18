/**
 * What a simulated caller asked for, decided deterministically (P12.09.01, M1 vertical slice).
 *
 * The slice handles one intent: "please call me back". The utterance is normalised (Unicode NFC,
 * control characters removed, whitespace collapsed) and recognised by fixed German phrases: no
 * model, no guess. Three outcomes:
 *
 *  - unsupported: not a callback request, or one whose consent to contact is not established: a
 *    refusal ("bitte nicht zurückrufen", "keinen Rückruf"), a take-back, or a negation the grammar
 *    does not recognise as harmless. Nothing is created; the HTTP boundary answers 422 before any
 *    write.
 *  - invalid: empty, or longer than the contract allows.
 *  - callback, titled with one of four constant titles (CALLBACK_TITLES). The title names the
 *    broad topic of the callback, never a detail: no guest count, no weekday, no month, and no
 *    word of the caller. A topic is named only when the request plainly is about a new
 *    reservation or a birthday celebration; a negation, cancellation, change, complaint, doubt or
 *    existing booking keeps the generic title. A callback request is not a booking, so no title
 *    says reserved or confirmed.
 *
 * Founder scope decision (PRODUCT-01, 2026-10-19): counts and dates are deliberately not extracted.
 * Four review rounds showed that tying a stated number or day to the booking, rather than to the
 * callback or to something else, needs more than a small grammar; the deferred capability is
 * recorded in EV-P12-015.
 *
 * The raw utterance is never stored (INV-07, INV-12). The title takes part in the request hash of
 * the call's acceptance (`callback-intake.ts`), so a call accepted under an earlier version of these
 * rules and delivered again with the same words may be refused as a conflicting request (409), never
 * duplicated or reopened; and one whose words are now judged unsupported (a refusal) is answered 422
 * at the interpretation step, before the acceptance is consulted. Pure, no I/O. Every pattern is
 * linear and runs on input already capped at UTTERANCE_MAX_LENGTH characters.
 */

import { UTTERANCE_MAX_LENGTH } from '@moin/contracts';

export const CALLBACK_TITLES = [
  'Rückruf erbeten',
  'Rückruf: Reservierung',
  'Rückruf: Geburtstagsfeier',
  'Rückruf: Reservierung für Geburtstagsfeier',
] as const;

export type CallbackTitle = (typeof CALLBACK_TITLES)[number];

export const GENERIC_CALLBACK_TITLE: CallbackTitle = 'Rückruf erbeten';

export type CallInterpretation =
  | { readonly kind: 'callback'; readonly title: CallbackTitle }
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
// A celebration is named as one ("Geburtstagsfeier", "-essen", "-party"); a bare "Geburtstag" counts
// only beside a reservation or the word "feiern", so "Geburtstagsgeschenk" and "Geburtstag meiner
// Mutter" are not announced as a party.
const BIRTHDAY_CELEBRATION =
  /(?<!\p{L})(?:kinder)?geburtstag(?:sfeier(?:n)?|sessen|sparty|sparties)(?!\p{L})/iu;
const BIRTHDAY_BARE = /(?<!\p{L})(?:kinder)?geburtstags?(?!\p{L})/iu;
const CELEBRATE = /(?<!\p{L})(?:feier|feiern|feiere)(?!\p{L})/iu;

// The request may not be for a new reservation or celebration: it is negated, cancelled, changed,
// doubted, offered as an alternative, about an existing or past booking, a complaint, or about
// booking software ("Onlinebuchung", "Reservierungssystem"). The title then stays generic rather
// than name a topic that may be untrue.
const TOPIC_UNCERTAIN = new RegExp(
  [
    '(?<!\\p{L})(?:nicht|kein\\p{L}*|nie|niemals|ohne|oder|statt|anstatt|sondern|ob|vielleicht|eventuell|evtl|falls|eher|schon|bereits',
    'storn\\p{L}*|absag\\p{L}*|abbestell\\p{L}*|cancel\\p{L}*|lösch\\p{L}*|annullier\\p{L}*|rückgängig|ausfall\\p{L}*|ausgefallen|fällt|verschieb\\p{L}*|verschoben|zurückzieh\\p{L}*|aufheb\\p{L}*|streich\\p{L}*|kündig\\p{L}*|verleg\\p{L}*|umbuch\\p{L}*|umstell\\p{L}*|tausch\\p{L}*|zurücknehm\\p{L}*|\\p{L}*änder\\p{L}*|anpass\\p{L}*|erhöh\\p{L}*|reduzier\\p{L}*|verringer\\p{L}*|verlänger\\p{L}*|bestätig\\p{L}*',
    'habe|haben|hat|hatte|hatten|gebucht|bestehend\\p{L}*|war|waren|wurde|wurden|gewesen|gestern|letzte\\p{L}*|vergangen\\p{L}*|zusätzlich\\p{L}*|zweite\\p{L}*|meines|seiner|seines|gilt|steht|stehen',
    'beschwer\\p{L}*|reklam\\p{L}*|problem\\p{L}*|fehler\\p{L}*|ärger\\p{L}*|kaputt|verloren|weg|wasser|laut|sauer|frech|enttäusch\\p{L}*|schlecht\\p{L}*|kalt|unfreundlich|rechnung\\p{L}*|vergess\\p{L}*|vergiss\\p{L}*|doppel\\p{L}*|funktionier\\p{L}*|klappt|online\\p{L}*|internet\\p{L}*|website|webseite|homepage|app|formular\\p{L}*|system\\p{L}*)(?!\\p{L})',
    '(?<!\\p{L})(?:mein|meine|meinen|meiner|unser|unsere|unseren|unserer|ihre|ihren|ihrer)\\s+(?:\\p{L}*reservierung|tischbuchung|buchung)',
    'reservierungs\\p{L}+',
  ].join('|'),
  'iu',
);

const CLAUSE_BREAK = /[.!?;,:]+/u;

/** A bare "Geburtstag" is a celebration only beside a reservation or "feiern" in its own clause. */
function bareBirthday(clause: string): boolean {
  return BIRTHDAY_BARE.test(clause) && (RESERVATION.test(clause) || CELEBRATE.test(clause));
}

/** The constant title for the request's topic: the generic one unless the topic is plain. */
function topicTitle(utterance: string): CallbackTitle {
  const reservation = RESERVATION.test(utterance);
  const birthday =
    BIRTHDAY_CELEBRATION.test(utterance) || utterance.split(CLAUSE_BREAK).some(bareBirthday);
  if ((!reservation && !birthday) || TOPIC_UNCERTAIN.test(utterance)) return GENERIC_CALLBACK_TITLE;
  if (reservation && birthday) return 'Rückruf: Reservierung für Geburtstagsfeier';
  return birthday ? 'Rückruf: Geburtstagsfeier' : 'Rückruf: Reservierung';
}

/** NFC, control characters dropped, whitespace runs collapsed to one space, trimmed. */
export function normaliseUtterance(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
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
  return { kind: 'callback', title: topicTitle(utterance) };
}
