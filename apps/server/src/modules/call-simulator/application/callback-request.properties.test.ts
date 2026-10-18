import { describe, expect, it } from 'vitest';
import { interpretCall } from './callback-request.ts';

// Fourth independent review (1608108): F2 and F3 again. The cases below are the reviewer's
// counterexamples and fixed, enumerated combinations (no random input, so a failure reproduces).

const titleOf = (utterance: string): string => {
  const result = interpretCall(utterance);
  if (result.kind !== 'callback') throw new Error(`not a callback: ${utterance}`);
  return result.title;
};

describe('F2: a reservation noun alone does not license a date', () => {
  it.each([
    'Ich möchte am Freitag die Reservierung telefonisch besprechen. Bitte Rückruf.',
    'Ich möchte telefonisch über die Reservierung am Freitag sprechen. Bitte Rückruf.',
    'Ich möchte am Freitag die Reservierung besprechen. Bitte Rückruf.',
    'Ich möchte eine Reservierung am Freitag klären. Bitte Rückruf.',
    'Ich möchte telefonisch über eine Reservierung am Freitag reden. Bitte Rückruf.',
    'Ich habe eine Reservierung am Freitag. Bitte Rückruf.',
    'Wegen der Reservierung am Freitag bitte Rückruf.',
    'Bitte Rückruf wegen unserer Reservierung am Freitag.',
    'Ich möchte am Freitag die Reservierung klären. Bitte Rückruf.',
  ])('no booking date: %s', (utterance) => {
    expect(titleOf(utterance)).toBe('Rückruf: Reservierung');
  });

  it.each([
    ['Ich möchte einen Tisch für Samstag reservieren. Bitte um Rückruf.', 'am Samstag'],
    ['Rufen Sie am Freitag zurück. Ich möchte einen Tisch für Samstag reservieren.', 'am Samstag'],
    ['Ich möchte am Samstag einen Tisch reservieren. Bitte Rückruf.', 'am Samstag'],
  ])('a new reservation request keeps its day: %s', (utterance, day) => {
    expect(titleOf(utterance)).toBe(`Rückruf: Reservierung ${day}`);
  });

  it('keeps the founder birthday and the table sentences', () => {
    expect(titleOf('Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.')).toBe(
      'Rückruf: Geburtstagsfeier im Dezember',
    );
    expect(titleOf('Bitte um Rückruf wegen einer Tischreservierung für Samstag.')).toBe(
      'Rückruf: Tischreservierung am Samstag',
    );
  });
});

describe('F3: any range or hedge voids the count, whatever its endpoints are', () => {
  it.each([
    'Bitte Rückruf. Reservierung für 20 Personen, es werden fünfzehn bis 20 Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden null bis acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden hundert bis 8 Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden zwischen fünf und acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden fünf oder sechs Gäste.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden dreißig-8 Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, ungefähr acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, es werden bis zu acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen, mindestens acht Personen.',
    'Bitte Rückruf. Reservierung für 8 Personen und für 100 Personen.',
  ])('no count: %s', (utterance) => {
    expect(titleOf(utterance)).toBe('Rückruf: Reservierung');
  });

  it.each([
    ['Bitte Rückruf. Reservierung für 8 Personen.', 'Rückruf: Reservierung für 8 Personen'],
    [
      'Bitte Rückruf. Reservierung für 8 Personen, wir sind 8 Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
    [
      'Bitte Rückruf unter 040 1234 567. Reservierung für acht Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
    [
      'Bitte am 12. Dezember zurückrufen. Reservierung für 8 Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
  ])('exact and unrelated numbers: %s', (utterance, expected) => {
    expect(titleOf(utterance)).toBe(expected);
  });
});

describe('metamorphic properties over enumerated combinations', () => {
  const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Freitag', 'Sonntag'];
  const CONTACT = (day: string): string[] => [
    `Bitte am ${day} zurückrufen.`,
    `Rufen Sie am ${day} zurück.`,
    `Ich bin am ${day} erreichbar. Bitte Rückruf.`,
    `Bitte am ${day} telefonieren. Rückruf bitte.`,
    `Bitte Rückruf im Dezember, am ${day} bin ich da.`,
    `Ich möchte am ${day} die Reservierung telefonisch besprechen. Bitte Rückruf.`,
  ];
  const UNDATED = ['Ich möchte einen Tisch reservieren.', 'Es geht um eine Reservierung.'];

  it('a callback or availability date never becomes, or changes, the booking date', () => {
    for (const booking of UNDATED) {
      for (const day of DAYS) {
        for (const contact of CONTACT(day)) {
          for (const utterance of [`${contact} ${booking}`, `${booking} ${contact}`]) {
            expect(titleOf(utterance), utterance).toBe('Rückruf: Reservierung');
          }
        }
      }
    }
  });

  it('the stated booking day is the same whichever day the callback names', () => {
    for (const day of DAYS) {
      for (const contact of CONTACT(day).slice(0, 4)) {
        const utterance = `${contact} Ich möchte einen Tisch für Samstag reservieren.`;
        expect(titleOf(utterance), utterance).toBe('Rückruf: Reservierung am Samstag');
      }
    }
  });

  const BASES = [
    'Bitte Rückruf. Ich möchte für 8 Personen reservieren.',
    'Rückruf bitte, Reservierung für acht Personen.',
  ];
  const UNCERTAIN = [
    'Es werden 6–8 Personen.',
    'Es werden fünfzehn bis 20 Personen.',
    'Es werden null bis acht Personen.',
    'Es werden 5 oder 6 Personen.',
    'Es werden ungefähr 8 Personen.',
    'Es werden mindestens 8 Personen.',
    'Es werden bis zu 8 Personen.',
    'Es werden 100 Personen.',
    'Es werden dreißig Personen.',
    'Es werden 9 Personen.',
  ];

  it('adding uncertainty before or after an exact count removes the count', () => {
    for (const base of BASES) {
      expect(titleOf(base), base).toBe('Rückruf: Reservierung für 8 Personen');
      for (const extra of UNCERTAIN) {
        for (const utterance of [`${base} ${extra}`, `${extra} ${base}`]) {
          expect(titleOf(utterance), utterance).toBe('Rückruf: Reservierung');
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
  ];

  it('an unrelated personal disclosure never changes or enters the title', () => {
    for (const base of [
      ...BASES,
      'Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.',
    ]) {
      const expected = titleOf(base);
      for (const extra of DISCLOSURES) {
        for (const utterance of [`${base} ${extra}`, `${extra} ${base}`]) {
          // A number in a disclosure may cost the optional count (it could restate it), never add to the title.
          expect(expected.startsWith(titleOf(utterance)), utterance).toBe(true);
          expect(titleOf(utterance), utterance).not.toMatch(/PIN|HIV|IBAN|Passwort|@/u);
        }
      }
    }
  });

  const REFUSALS = [
    'Bitte nicht zurückrufen.',
    'Rückruf ist nicht erwünscht.',
    'Bitte nie zurückrufen.',
  ];

  it('an explicit refusal added to any request creates no callback', () => {
    for (const base of [...BASES, 'Bitte rufen Sie mich zurück.']) {
      for (const refusal of REFUSALS) {
        for (const utterance of [`${base} ${refusal}`, `${refusal} ${base}`]) {
          expect(interpretCall(utterance), utterance).toStrictEqual({ kind: 'unsupported' });
        }
      }
    }
  });
});

// Adversarial pass over 1608108+: new utterances from a reviewer who had not seen the implementation.
describe('adversarial pass: ambiguity omits the detail, whatever the wording', () => {
  it.each([
    'Rückruf wegen Reservierungsstornierung für 4 Personen am Freitag',
    'Rückruf wegen Reservierungsbestätigung für Freitag',
    'Rückruf wegen Reservierungsänderung für 4 Personen am Samstag',
  ])('a compound noun is another subject, so the title stays neutral: %s', (utterance) => {
    expect(titleOf(utterance)).toBe('Rückruf erbeten');
  });

  it.each([
    'Rückruf bitte, ich möchte eine Reservierung am Freitag auf acht Personen erhöhen',
    'Rückruf, ich möchte eine Reservierung am Freitag prüfen lassen',
    'Rückruf wegen Reservierung am Freitag war das Essen kalt',
    'Rückruf wegen unserer Geburtstagsfeier am Samstag',
    'Rückruf wegen Geburtstagsfeier am Samstag der Kellner war unfreundlich',
    'Rückruf wegen Reservierung am Freitag',
    'Bitte um Rückruf wegen einer Reservierung am Freitag.',
  ])('the day cannot be told from the day to call: %s', (utterance) => {
    expect(titleOf(utterance)).toMatch(/^Rückruf: (Reservierung|Geburtstagsfeier)$/u);
  });

  it.each([
    'Reservierung für 6 Personen, evtl. 8, bitte Rückruf',
    'Reservierung für 6 Personen, wahrscheinlich, bitte Rückruf',
    'Reservierung für 6 Personen, gegebenenfalls 7, Rückruf bitte',
    'Reservierung für 6 Personen, 7 sind möglich, Rückruf bitte',
    'Reservierung für 6 Personen, es können auch 8 werden, bitte Rückruf',
    'Reservierung für 6 Personen, wenn alle kommen sind es 9, Rückruf bitte',
    'Reservierung für 6 Personen, wir sind aber 8, bitte zurückrufen',
    'Reservierung für 4 Personen, nein 5, bitte Rückruf',
    'Bitte Rückruf zur Reservierung weil wir letzte Woche mit 6 Personen da waren',
    'Rückruf wegen Reservierung weil die Rechnung für 6 Personen falsch war',
  ])('a count with any other number or doubt around it is not exact: %s', (utterance) => {
    expect(titleOf(utterance)).toBe('Rückruf: Reservierung');
  });

  it('times and telephone numbers beside an exact count do not void it', () => {
    expect(titleOf('Bitte Rückruf. Reservierung für 6 Personen um 19 Uhr.')).toBe(
      'Rückruf: Reservierung für 6 Personen',
    );
  });

  it.each([
    'Ich möchte nicht, dass Sie mich zurückrufen.',
    'Rückruf? Nein danke.',
    'Zurückrufen? Bitte nicht.',
    'Ein Rückruf wird nicht benötigt.',
    'Rückruf brauche ich nicht.',
    'Rückruf muss nicht sein.',
    'Auf einen Rückruf kann ich gerne verzichten.',
    'Weder Rückruf noch E-Mail bitte.',
    'Ein Rückruf kommt für mich nicht in Frage.',
    'Auf Rückrufe lege ich keinen Wert.',
    'Lassen Sie den Rückruf bitte sein.',
    'Ich rufe Sie später zurück wegen der Reservierung.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it('a timing condition is not a refusal', () => {
    expect(titleOf('Bitte kein Rückruf vor zehn Uhr, danach gerne.')).toBe('Rückruf erbeten');
  });
});

describe('adversarial pass, second round', () => {
  it.each([
    'Rückruf wegen Reservierung für 4 Personen, vermutlich.',
    'Rückruf wegen Reservierung für 4 Personen, glaube ich.',
    'Rückruf wegen Reservierung für 4 Personen, soweit ich weiß.',
    'Rückruf wegen Reservierung für Freitag, vermutlich.',
    'Rückruf wegen Reservierung für Freitag, sofern es klappt.',
    'Bitte Rückruf wegen einer Reservierung für Freitag zwischen 10 und 12 Uhr.',
    'Bitte Rückruf wegen einer Reservierung für Freitag gegen zehn Uhr.',
    'Bitte Rückruf wegen einer Reservierung für Freitag nach 15 Uhr.',
  ])('the hedge or call window voids the detail: %s', (utterance) => {
    expect(titleOf(utterance)).toBe('Rückruf: Reservierung');
  });

  it.each([
    [
      'Ich möchte einen Tisch reservieren, aber nur für 4 Personen. Bitte rufen Sie mich zurück.',
      'Rückruf: Reservierung',
    ],
    [
      'Wären Sie so nett, mich zurückzurufen? Es geht um eine Reservierung.',
      'Rückruf: Reservierung',
    ],
    [
      'Ich habe versucht Sie zu erreichen. Bitte rufen Sie mich zurück. Ich rufe Sie sonst morgen an.',
      'Rückruf erbeten',
    ],
    ['Ich möchte nicht, dass Sie zu spät zurückrufen.', 'Rückruf erbeten'],
    ['Kein Rückruf morgen früh, danach gern.', 'Rückruf erbeten'],
  ])('an everyday positive request stays a callback: %s', (utterance, expected) => {
    expect(titleOf(utterance)).toBe(expected);
  });
});
