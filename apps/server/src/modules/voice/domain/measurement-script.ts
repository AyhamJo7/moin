/**
 * The scripted call used for the feasibility measurement (P04.04.04, P04.05.02).
 *
 * ## Why a script and not a dialogue
 *
 * P04 asks one question: can German speech over ConversationRelay capture the values this product
 * depends on, fast enough to feel like a phone call? An LLM in the loop would make that question
 * unanswerable — a wrong answer could be the model's fault, the transcriber's, or the prompt's, and
 * fifty calls would not tell us which. The phase brief is explicit: *only scripted responses in the
 * spike; no LLM wording is spoken to real callers.*
 *
 * So the call is a fixed sequence of asks, one per slot type, each followed by a read-back of what
 * was heard. The read-back is not politeness: it is the measurement. A volunteer reading a
 * prepared card knows what they said, and the read-back is what the system believes they said.
 *
 * ## The slot types are the ones the product will fail on
 *
 * German phone numbers spoken as pairs ("vierzig / dreiundzwanzig"), surnames with umlauts, a
 * five-digit postcode, a date and time in the form people actually use ("nächsten Dienstag um
 * halb drei"), and a party size. Each is a different failure mode for a transcriber, and averaging
 * them into one accuracy number would hide the one that matters.
 *
 * The final step is DTMF, because PLAN's answer to a low-confidence critical slot is a keypress,
 * and a keypress that does not arrive is worse than a transcription that is wrong.
 */

export const SLOT_KINDS = [
  'name',
  'phone',
  'postcode',
  'datetime',
  'party_size',
  'dtmf_confirm',
] as const;

export type SlotKind = (typeof SLOT_KINDS)[number];

export interface ScriptStep {
  readonly slot: SlotKind;
  /** What the assistant says to elicit the slot. */
  readonly ask: string;
  /** How the assistant repeats what it heard, so the caller can judge it. */
  readonly readBack: (heard: string) => string;
  /** Whether this step expects speech or a keypress. */
  readonly expects: 'speech' | 'dtmf';
}

export const MEASUREMENT_SCRIPT: readonly ScriptStep[] = [
  {
    slot: 'name',
    ask: 'Bitte nennen Sie Ihren Vor- und Nachnamen.',
    readBack: (heard) => `Ich habe verstanden: ${heard}.`,
    expects: 'speech',
  },
  {
    slot: 'phone',
    ask: 'Bitte nennen Sie Ihre Telefonnummer.',
    readBack: (heard) => `Ich habe verstanden: ${heard}.`,
    expects: 'speech',
  },
  {
    slot: 'postcode',
    ask: 'Bitte nennen Sie Ihre Postleitzahl.',
    readBack: (heard) => `Ich habe verstanden: ${heard}.`,
    expects: 'speech',
  },
  {
    slot: 'datetime',
    ask: 'Für welchen Tag und welche Uhrzeit möchten Sie den Termin?',
    readBack: (heard) => `Ich habe verstanden: ${heard}.`,
    expects: 'speech',
  },
  {
    slot: 'party_size',
    ask: 'Für wie viele Personen?',
    readBack: (heard) => `Ich habe verstanden: ${heard}.`,
    expects: 'speech',
  },
  {
    slot: 'dtmf_confirm',
    ask: 'Zum Abschluss drücken Sie bitte die Eins auf Ihrer Tastatur.',
    readBack: (heard) => `Ich habe die Taste ${heard} empfangen.`,
    expects: 'dtmf',
  },
];

export const CLOSING_LINE = 'Vielen Dank. Der Testanruf ist beendet. Auf Wiederhören.';
