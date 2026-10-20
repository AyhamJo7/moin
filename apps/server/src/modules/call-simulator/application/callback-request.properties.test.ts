import { describe, expect, it } from 'vitest';
import { CALLBACK_TITLES, interpretCall } from './callback-request.ts';

// The four titles the founder authorised, written out here so that the contract is checked against
// the decision itself, not against the module's own list.
const ALLOWED = [
  'Rückruf erbeten',
  'Rückruf: Reservierung',
  'Rückruf: Geburtstagsfeier',
  'Rückruf: Reservierung für Geburtstagsfeier',
];

// Metamorphic properties of the category-only contract over fixed, enumerated combinations (no
// random input, so a failure reproduces). Every base request has a known title; adding a count, a
// date, a disclosure or unrelated negation must not change it, and adding a refusal must remove the
// callback. The bases cover all four titles, so a classifier that always answered "Rückruf erbeten"
// would fail here.

const titleOf = (utterance: string): string => {
  const result = interpretCall(utterance);
  if (result.kind !== 'callback') throw new Error(`not a callback: ${utterance}`);
  return result.title;
};

const BASES: readonly (readonly [string, string])[] = [
  ['Bitte rufen Sie mich zurück.', 'Rückruf erbeten'],
  ['Ich möchte einen Tisch reservieren. Bitte um Rückruf.', 'Rückruf: Reservierung'],
  ['Es geht um eine Geburtstagsfeier. Bitte rufen Sie zurück.', 'Rückruf: Geburtstagsfeier'],
  [
    'Bitte um Rückruf wegen einer Tischreservierung für eine Geburtstagsfeier.',
    'Rückruf: Reservierung für Geburtstagsfeier',
  ],
];

// What a title may never carry: a digit, a count noun, a weekday, a month or a time.
const DETAIL =
  /\d|person|gäst|gast|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|uhr|abend|morgen/iu;

const sentences = (base: string, extra: string): string[] => [
  `${base} ${extra}`,
  `${extra} ${base}`,
];

describe('category-only output', () => {
  it('the base requests reach all four titles', () => {
    expect(BASES.map(([base]) => titleOf(base))).toStrictEqual(ALLOWED);
    expect([...CALLBACK_TITLES]).toStrictEqual(ALLOWED);
  });

  const STATED = [
    ['für 8 Personen', 'am Freitag'],
    ['für sechs Personen', 'am Samstagabend'],
    ['für 2 Gäste', 'im Dezember'],
    ['für eine Person', 'für Sonntag'],
  ];

  it('a count and a day stated plainly inside the booking never reach the title', () => {
    for (const [count, day] of STATED) {
      for (const utterance of [
        `Ich möchte ${count} ${day} einen Tisch reservieren. Bitte um Rückruf.`,
        `Bitte Rückruf wegen einer Reservierung ${count} ${day}.`,
        `Rückruf bitte, Geburtstagsfeier mit Tischreservierung ${count} ${day}.`,
      ]) {
        const title = titleOf(utterance);
        expect(ALLOWED, utterance).toContain(title);
        expect(title, utterance).not.toMatch(DETAIL);
      }
    }
  });

  const COUNTS = [
    'Wir sind 8 Personen.',
    'Es werden 6–8 Personen.',
    'Es werden fünfzehn bis 20 Personen.',
    'Es werden null bis acht Personen.',
    'Für sechs Personen.',
    'Mit 99 Gästen.',
    'Für 100 Personen.',
    'Wir kommen zu zweit.',
  ];

  it('adding a guest count, exact or not, never changes the title', () => {
    for (const [base, expected] of BASES) {
      for (const count of COUNTS) {
        for (const utterance of sentences(base, count)) {
          expect(titleOf(utterance), utterance).toBe(expected);
        }
      }
    }
  });

  const DAYS = ['Montag', 'Freitag', 'Samstag'];
  const MONTHS = ['März', 'Dezember'];
  const DATES = [
    ...DAYS.flatMap((day) => [`Am ${day}.`, `Für ${day}.`, `Bitte am ${day} zurückrufen.`]),
    ...MONTHS.flatMap((month) => [`Im ${month}.`, `Bitte im ${month} zurückrufen.`]),
    'Am Freitagabend um 19 Uhr.',
    'Am 12. Dezember.',
  ];

  it('adding a weekday, month or time, for the booking or the callback, never changes the title', () => {
    for (const [base, expected] of BASES) {
      for (const date of DATES) {
        for (const utterance of sentences(base, date)) {
          expect(titleOf(utterance), utterance).toBe(expected);
        }
      }
    }
  });

  const DISCLOSURES = [
    'Meine PIN lautet 4821.',
    'Ich bin HIV-positiv.',
    'IBAN DE02120300000000202051.',
    'Mein Passwort ist Sommer2026.',
    'Schreiben Sie an anna.mueller@example.test.',
    'Hier ist Frau Anna Müller, Telefon 040 1234567.',
  ];

  it('adding an unrelated personal disclosure never changes the title', () => {
    for (const [base, expected] of BASES) {
      for (const disclosure of DISCLOSURES) {
        for (const utterance of sentences(base, disclosure)) {
          expect(titleOf(utterance), utterance).toBe(expected);
        }
      }
    }
  });

  // The inputs that earlier rounds used to test counts and dates (reviewer counterexamples included).
  // Each must now give a constant title and no detail; a refusal among them stays unsupported.
  const DETAIL_CORPUS = [
    'Ich möchte am Freitag die Reservierung telefonisch besprechen. Bitte Rückruf.',
    'Bitte Rückruf. Reservierung für 20 Personen, es werden fünfzehn bis 20 Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden null bis acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden 6–8 Personen.',
    'Rückruf bitte, Reservierung für 6 Personen am Freitag',
    'Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 99 Personen am Donnerstag',
    'Rückruf bitte, Geburtstagsfeier am Freitag im Dezember',
    'Rückruf bitte, Reservierung für 4 Personen, also für vier Personen',
    'Rückruf bitte, Reservierung für 5 oder 6 Personen',
    'Rückruf bitte, Reservierung für mindestens sechs Personen',
    'Rückruf bitte, Reservierung am Freitag und Samstag',
    'Rückruf: Reservierung für eine Person',
    'Rufen Sie mich Freitag zurück, ich möchte für Samstag reservieren',
    'Bitte im Dezember zurückrufen, Reservierung am Freitag',
    'Bitte am Freitag um 10 Uhr zurückrufen. Ich möchte einen Tisch reservieren.',
    'Ich möchte am Freitag einen Tisch reservieren. Bitte rufen Sie zurück.',
    'Bitte wegen einer Reservierung am Freitag zurückrufen, dann bin ich erreichbar.',
    'Bitte Rückruf wegen einer Reservierung für Freitag zwischen 10 und 12 Uhr.',
    'Tisch für Samstag reservieren, bitte Rückruf.',
    'Bitte bis Freitag zurückrufen. Reservierung für 8 Personen.',
    'Bitte Rückruf unter 040 1234 567. Reservierung für acht Personen.',
    'Bitte am 12. Dezember zurückrufen. Reservierung für 8 Personen.',
    'Rückruf Reservierung für constructor Personen',
    'Rückruf Reservierung für __proto__ Personen',
    'Reservierung für 6 Personen, 7 sind möglich, Rückruf bitte',
    'Ich möchte einen Tisch reservieren, aber nur für 4 Personen. Bitte rufen Sie mich zurück.',
    'Rückruf bitte, Familie Müller, Telefon 040 1234567',
  ];

  it('the earlier count and date inputs give a constant title and no detail', () => {
    for (const utterance of DETAIL_CORPUS) {
      const result = interpretCall(utterance);
      expect(result.kind, utterance).toBe('callback');
      const title = result.kind === 'callback' ? result.title : '';
      expect(ALLOWED, utterance).toContain(title);
      expect(title, utterance).not.toMatch(DETAIL);
    }
  });

  it('the reviewer counterexamples cannot produce their unsafe titles', () => {
    expect(
      titleOf('Bitte Rückruf. Reservierung für 8 Personen, es werden null bis acht Personen.'),
    ).toBe('Rückruf: Reservierung');
    expect(
      titleOf('Ich möchte am Freitag die Reservierung telefonisch besprechen. Bitte Rückruf.'),
    ).toBe('Rückruf: Reservierung');
  });
});

describe('refusal and unrelated negation', () => {
  const REFUSALS = [
    'Bitte nie zurückrufen.',
    'Bitte auf keinen Fall zurückrufen.',
    'Rückruf ist nicht erwünscht.',
    'Bitte nicht zurückrufen.',
    'Ich möchte keinen Rückruf.',
    'Bitte nicht mehr zurückrufen.',
  ];

  it('adding an explicit refusal to any request creates no callback', () => {
    for (const [base] of BASES) {
      for (const refusal of REFUSALS) {
        for (const utterance of sentences(base, refusal)) {
          expect(interpretCall(utterance), utterance).toStrictEqual({ kind: 'unsupported' });
        }
      }
    }
  });

  const UNRELATED_NEGATION = [
    'Die Onlinebuchung funktioniert nicht.',
    'Das Formular funktioniert nicht.',
    'Ich kann gerade nicht sprechen.',
    'Die Seite lädt nicht.',
    'Ich komme online nicht weiter.',
  ];

  it('adding unrelated negation keeps the callback, at worst with the generic title', () => {
    for (const [base] of BASES) {
      for (const negation of UNRELATED_NEGATION) {
        for (const utterance of sentences(base, negation)) {
          expect(interpretCall(utterance), utterance).toStrictEqual({
            kind: 'callback',
            title: 'Rückruf erbeten',
          });
        }
      }
    }
  });
});
