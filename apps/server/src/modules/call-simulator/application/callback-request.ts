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

// "Rückruf", "zurückrufen", "zurückzurufen", "zurück rufen", "zurückgerufen werden", "ruf(en Sie) mich
// bitte zurück". A bare "zurückgerufen" reports a callback that happened; it asks for nothing.
const CALLBACK_PHRASE =
  /rückruf|zurück\s*(?:zu)?ruf|zurückgerufen\s+(?:zu\s+)?werden|\bruf\p{L}*\s+(?:\p{L}+\s+){0,3}zurück\b/iu;
// Mentions of a callback that ask for nothing: thanks for one, one received, a product recall, the
// callback number.
const NOT_A_REQUEST =
  /dank\p{L}*\s+für\s+(?:den|ihren|deinen|einen)\s+rückruf\p{L}*|rückruf\p{L}*\s+(?:von\s+\p{L}+\s+)?(?:bekommen|erhalten|gehabt|gekriegt)(?!\p{L})|rückruf(?:aktion|nummer)\p{L}*|(?:es\s+kam|bisher|bislang)\s+(?:noch\s+)?kein(?:en)?\s+(?:rückruf|anruf)\p{L}*/giu;

// Contact consent is denied by default. Every refusal word in the utterance must be explained by one
// of the harmless constructions below, or the request is unsupported: "Ein Rückruf wäre nicht nötig",
// "Rückruf? Ist nicht nötig.", "Kein Bedarf", "Hat sich erledigt", "doch lieber nicht" all refuse,
// however they are phrased or split. A negation that is not recognised as harmless costs a wanted
// callback (the caller can ask again), never creates an unwanted one.
const REFUSAL_WORD =
  /(?<!\p{L})(?:nicht|nichts|nie|niemals|kein\p{L}*|keinesfalls|keineswegs|nein|nee|nö|weder|unnötig|überflüssig|unerwünscht|verboten|erledigt|erübrigt|geklärt|entfällt|egal|verzicht\p{L}*|unterlass\p{L}*|vermeid\p{L}*|verbiet\p{L}*|stornier\p{L}*|abbestell\p{L}*|absag\p{L}*|widerruf\p{L}*|spar(?:en|t)|verg[ei]ss\p{L}*|lass\p{L}*|statt|anstatt|stattdessen|hinfällig|zwecklos|überholt|versehen|wozu|schriftlich\p{L}*|zurückzieh\p{L}*|zurückgezogen|zurücknehm\p{L}*|zurückgenommen)(?!\p{L})|(?<!\p{L})(?:ohne|statt)\s+(?:\p{L}+\s+)?(?:rückruf|anruf)|(?<!\p{L})(?:passt\s+schon|schon\s+gut|alles\s+gut)(?!\p{L})|(?<!\p{L})(?:zieh|nehm)\p{L}*\s+(?:[\p{L}-]+\s+){0,5}zurück(?!\p{L})|(?<!\p{L})(?:per|lieber|als|via)\s+(?:eine?\s+)?(?:e-?mail|mail|sms|whatsapp|nachricht|brief|post)(?!\p{L})/iu;

// A noun a harmless construction may name: never a contact word or the request itself, even in a compound.
const PLAIN = `(?![\\p{L}-]*(?:ruf|telefon|kontakt|gespräch|meld|zurück|anfrage|bitte|ganze|sache|mühe))\\p{L}[\\p{L}-]*`;
// A booking the caller may cancel; never the request itself ("die Rückruf-Anfrage stornieren").
const BOOKING_NOUN = `(?![\\p{L}-]*(?:ruf|anfrage|bitte))[\\p{L}-]*(?:reservierung|buchung|feier|party|bestellung)`;
const NEG = '(?:nicht|kein\\p{L}*)';
const END = '(?=\\s*(?:[.!?;,:–-]|$))';
const DAY =
  '(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|abend|vormittag|nachmittag|mittag)';
const HOUR =
  '(?:\\d{1,2}(?:[.:]\\d{2})?(?!\\d)(?:\\s*uhr)?|(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)(?:\\s+uhr)?)';
// A thing that fails, as the subject of a technical complaint: "die Onlinebuchung funktioniert nicht",
// "das Formular geht nicht", "die Bestätigung kam nicht an". Only these verbs, and the noun is never a
// contact word: "Das muss nicht sein" and "Der Rückruf ist nicht nötig" are not explained by it.
const FAULT_VERB =
  '(?:funktionier\\p{L}*|geht|ging|lädt|klappt|klappte|läuft|lief|reagiert|öffnet|zeigt|akzeptiert|kam|kommt|ankam|ankommt|stimmt|erscheint)';
const DETERMINER = '(?:der|die|das|ihr|ihre|mein|meine|unser|unsere|eure)';
const ADVERB = '(?:bei\\s+mir|leider|immer\\s+noch|noch|mehr|doch|einfach)';
const HARMLESS = [
  new RegExp(
    `(?<!\\p{L})${DETERMINER}\\s+${PLAIN}\\s+(?:${FAULT_VERB}\\s+(?:${ADVERB}\\s+)*${NEG}(?:\\s+(?:mehr|richtig|an))*|(?:${ADVERB}\\s+)*${NEG}(?:\\s+(?:mehr|richtig))*\\s+${FAULT_VERB})${END}`,
    'giu',
  ),
  // A booking the caller cancels or changes, named as the object: "die Reservierung stornieren", "die
  // Geburtstagsfeier absagen", "Stornieren Sie den Rückruf" is not one.
  new RegExp(
    `(?<!\\p{L})${DETERMINER}\\s+${BOOKING_NOUN}\\s+(?:stornieren|absagen|abbestellen|canceln)(?!\\p{L})`,
    'giu',
  ),
  // Something the caller does not do or cannot do: "nicht online reservieren", "kann gerade nicht
  // sprechen", "nicht stornieren", "komme online nicht weiter", "bin morgen nicht erreichbar".
  /(?<!\p{L})nicht\s+(?:(?:mehr|online|im\s+internet|selbst|so\s+gut|richtig)\s+)*(?:reservieren|buchen|bestellen|stornieren|kommen|finden|erreichbar|da|online)(?!\p{L})/giu,
  /(?<!\p{L})komm\p{L}*\s+(?:(?:online|damit|hier|leider|da)\s+)*nicht\s+weiter(?!\p{L})/giu,
  /(?<!\p{L})(?:kann|konnte|könnte)\s+(?:(?:gerade|jetzt|leider|im\s+moment)\s+)*nicht\s+sprechen(?!\p{L})/giu,
  // A real time limit: "nicht vor 18 Uhr", "kein Rückruf morgens", "nicht am Wochenende", "nicht zu spät".
  new RegExp(
    `(?<!\\p{L})${NEG}(?:\\s+(?:mehr|rückruf\\p{L}*|anruf\\p{L}*|anrufen|zurückrufen))?\\s+(?:(?:vor|nach|ab|bis|um|gegen)\\s+(?:${HOUR}|(?:dem\\s+)?(?:mittag|mittagessen|feierabend|wochenende|${DAY}))|morgens|vormittags|mittags|nachmittags|abends|nachts|morgen\\s+früh|zu\\s+spät|zu\\s+früh|am\\s+${DAY})(?!\\p{L})(?!\\s*(?:,|und|oder)\\s*(?:morgens|vormittags|mittags|nachmittags|abends|nachts))`,
    'giu',
  ),
  // A reminder: "nicht vergessen", "Vergessen Sie (bitte) den Rückruf nicht".
  /(?<!\p{L})nicht\s+(?:zu\s+)?vergess\p{L}*|(?<!\p{L})verg[ei]ss\p{L}*(?:\s+(?:sie|du|ihr|bitte|den|meinen|unseren|rückruf|aber))*\s+nicht(?!\p{L})/giu,
  // A callback that did not come, as a report: "Ich habe keinen Rückruf bekommen", "Sie haben mich nicht
  // zurückgerufen", "Es kam noch kein Rückruf", "Bisher kein Rückruf", "Warum rufen Sie nicht zurück?"
  new RegExp(
    `(?<!\\p{L})(?:ich|wir|sie|ihr\\s+\\p{L}+|man)\\s+(?:habe|haben|hat|hatte|hatten|bin|wurde|wurden)\\s+(?:(?:leider|noch|bisher|bislang|immer|mich|uns)\\s+)*(?:nicht|keinen|kein|nie)\\s+(?:(?:einen\\s+)?(?:rückruf|anruf)\\s+)?(?:von\\s+(?:ihnen|euch|dir)\\s+)?(?:bekommen|erhalten|gehabt|gekriegt|zurückgerufen|angerufen)${END}`,
    'giu',
  ),
  new RegExp(
    `(?:(?<!\\p{L})es\\s+kam|(?:^|(?<=[.!?;,:]\\s*))(?:bisher|bislang))\\s+(?:noch\\s+)?(?:kein|keinen)\\s+(?:rückruf|anruf)${END}`,
    'giu',
  ),
  new RegExp(
    `(?<!\\p{L})(?:warum|wieso)\\s+(?:rufen|ruft)\\s+(?:sie|ihr)\\s+(?:mich\\s+)?nicht\\s+zurück\\s*\\?`,
    'giu',
  ),
  // Set phrases: "Keine Eile", "Kein Problem", "Nicht dringend", "Nicht schlimm", "Warum nicht!".
  /(?<!\p{L})kein\p{L}*\s+(?:eile|problem|stress|sorge)(?!\p{L})|(?<!\p{L})nicht\s+(?:so\s+)?(?:dringend|eilig|schlimm)(?!\p{L})|(?<!\p{L})warum\s+nicht(?=\s*(?:[.!]|$))/giu,
];

/** Some refusal word is left once every harmless construction has been taken out. */
function refusalLeft(utterance: string): boolean {
  return REFUSAL_WORD.test(
    HARMLESS.reduce((text, pattern) => text.replace(pattern, ' '), utterance),
  );
}

// Each check finds a reason not to create callback work; a refusal wins over any positive wording in
// the same request.
const REFUSAL: readonly { test(utterance: string): boolean }[] = [
  // Only thanks, a received callback, a recall or a number: no request remains.
  { test: (utterance) => !CALLBACK_PHRASE.test(utterance.replace(NOT_A_REQUEST, ' ')) },
  { test: refusalLeft },
  // The caller will call back, so nobody here has work: "Ich rufe Sie später zurück", "Wir rufen
  // morgen zurück", "Später ruf ich selbst zurück", "Ich werde Sie zurückrufen", "Ich melde mich selbst".
  /(?<!\p{L})(?:ich|wir)\s+ruf\p{L}*\s+(?:\p{L}+\s+){0,3}zurück(?!\p{L})|(?<!\p{L})ruf(?:e|en)?\s+(?:ich|wir)\s+(?:\p{L}+\s+){0,3}zurück(?!\p{L})|(?<!\p{L})(?:ich|wir)\s+werde\p{L}*\s+(?:\p{L}+\s+){0,2}zurück\s*(?:zu)?ruf/iu,
  /(?<!\p{L})(?:ich|wir)\s+meld\p{L}*\s+(?:mich|uns)\s+(?:(?:doch|dann|einfach|gerne?|lieber)\s+)*(?:selbst|wieder|später|nochmal|noch\s+einmal|morgen)(?!\p{L})/iu,
  // A rhetorical question: "Warum zurückrufen?", "Wozu sollten Sie mich zurückrufen".
  /(?<!\p{L})(?:warum|wieso|weshalb|wozu)\s+(?:(?:sollten?|müssen|müssten)\s+(?:sie|ihr)\s+(?:mich\s+|uns\s+)?)?(?:zurück\s*(?:zu)?ruf|anruf|anzuruf)/iu,
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
