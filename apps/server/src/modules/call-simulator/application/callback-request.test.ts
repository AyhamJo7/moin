import { describe, expect, it } from 'vitest';
import { TASK_TITLE_MAX_LENGTH, todayTaskSchema } from '@moin/contracts';
import { GENERIC_CALLBACK_TITLE, interpretCall, normaliseUtterance } from './callback-request.ts';

describe('interpretCall (M1 callback slice)', () => {
  it.each([
    [
      'Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.',
      'Rückruf: Tischreservierung',
    ],
    [
      'Bitte rufen Sie mich zurück, wegen der Geburtstagsfeier am Samstag!',
      'Rückruf: Geburtstagsfeier am Samstag',
    ],
    // F1 (review of PR #242): a topic outside the vocabulary is no longer copied into the title.
    ['Können Sie mich zurückrufen? Es geht wegen meines Gutscheins', GENERIC_CALLBACK_TITLE],
    ['Ruf mich bitte zurück', GENERIC_CALLBACK_TITLE],
    ['RÜCKRUF bitte', GENERIC_CALLBACK_TITLE],
  ])('%s → %s', (utterance, title) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title });
  });

  it.each(['Wann haben Sie heute geöffnet?', 'Ich möchte einen Tisch für vier Personen', 'zurück'])(
    'leaves other requests unsupported: %s',
    (utterance) => {
      expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
    },
  );

  it('rejects empty, invisible-only and over-long utterances', () => {
    expect(interpretCall('')).toStrictEqual({ kind: 'invalid' });
    expect(interpretCall(' \u0000\u200b\t ')).toStrictEqual({ kind: 'invalid' });
    expect(interpretCall(`Rückruf ${'a'.repeat(500)}`)).toStrictEqual({ kind: 'invalid' });
  });

  // The two tests that stood here built a title by copying 100 characters after "wegen" and checked
  // the cut and the code-point count. Nothing is copied any more (F1), so they could not fail; what
  // remains of their purpose is that a title always fits the database and the contract, asserted
  // below for the longest title the grammar can produce.
  it('the longest title the grammar produces fits the database bound and the contract', () => {
    const result = interpretCall(
      'Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 99 Personen am Donnerstag',
    );
    const title = result.kind === 'callback' ? result.title : '';
    expect(title).toBe('Rückruf: Reservierung für Geburtstagsfeier für 99 Personen am Donnerstag');
    expect(Array.from(title)).toHaveLength(TASK_TITLE_MAX_LENGTH);
    expect(todayTaskSchema.shape.title.safeParse(title).success).toBe(true);
    expect(todayTaskSchema.shape.title.safeParse('🎂'.repeat(73)).success).toBe(false);
  });

  it('normalises to NFC and strips control and format characters', () => {
    expect(normaliseUtterance('  Ru\u0308ckruf\u0007 \u200bbitte\n\n ')).toBe('Rückruf bitte');
  });
});

describe('interpretCall: reservation and birthday requests (PRODUCT-01)', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    // The founder-rehearsal sentences.
    [
      'Bitte rufen Sie mich zurück, es geht um eine Geburtstagsfeier im Dezember.',
      'Rückruf: Geburtstagsfeier im Dezember',
    ],
    [
      'Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.',
      'Rückruf: Geburtstagsfeier im Dezember',
    ],
    [
      'Ich möchte für sechs Personen reservieren. Bitte um Rückruf.',
      'Rückruf: Reservierung für 6 Personen',
    ],
    [
      'Guten Tag, ich möchte für sechs Personen am Freitagabend reservieren. Bitte um Rückruf.',
      'Rückruf: Reservierung für 6 Personen am Freitag',
    ],
    // The M1 behaviour with "wegen" is unchanged.
    [
      'Hallo, hier ist Familie Weber. Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.',
      'Rückruf: Tischreservierung am Samstag',
    ],
    // Other ordinary phrasings.
    [
      'Rückruf bitte: Tischreservierung für 4 Gäste am Samstag',
      'Rückruf: Tischreservierung für 4 Personen am Samstag',
    ],
    ['Bitte zurückrufen, ich möchte einen Tisch buchen', 'Rückruf: Reservierung'],
    ['Rückruf bitte, ich habe eine Frage zur Reservierung', 'Rückruf: Reservierung'],
    ['Rückruf: Reservierung für eine Person', 'Rückruf: Reservierung für 1 Person'],
    [
      'Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 12 Personen',
      'Rückruf: Reservierung für Geburtstagsfeier für 12 Personen',
    ],
  ])('%s → %s', (utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it('is tolerant of capitalisation, punctuation and whitespace', () => {
    expect(
      title('  RÜCKRUF   BITTE!!!   RESERVIERUNG\tFÜR   SECHS   PERSONEN   AM   SAMSTAG '),
    ).toBe('Rückruf: Reservierung für 6 Personen am Samstag');
    // A comma ends the clause: "im Dezember" is then not demonstrably the booking's date (F2).
    expect(title('bitte zurückrufen...geburtstagsfeier,im  dezember')).toBe(
      'Rückruf: Geburtstagsfeier',
    );
    expect(title('BITTE   ZURÜCKRUFEN.   GEBURTSTAGSFEIER   IM   DEZEMBER')).toBe(
      'Rückruf: Geburtstagsfeier im Dezember',
    );
  });

  it('never states a callback request as a booking', () => {
    for (const utterance of [
      'Rückruf bitte, Reservierung für 6 Personen am Freitag',
      'Rückruf bitte, Geburtstagsfeier im Dezember',
    ]) {
      expect(title(utterance)).not.toMatch(/reserviert|bestätigt|gebucht|zugesagt/iu);
    }
  });

  it('adds no guest count or date that the caller did not state', () => {
    expect(title('Rückruf bitte, ich möchte reservieren')).toBe('Rückruf: Reservierung');
    expect(title('Rückruf bitte, Geburtstagsfeier')).toBe('Rückruf: Geburtstagsfeier');
  });

  it.each([
    [
      'hedged guest count',
      'Rückruf bitte, Reservierung für etwa sechs Personen',
      'Rückruf: Reservierung',
    ],
    [
      'approximate guest count',
      'Rückruf bitte, Reservierung für ca. 6 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'contradictory guest counts',
      'Rückruf bitte, Reservierung für 4 Personen, nein für 6 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'the same count repeated',
      'Rückruf bitte, Reservierung für 4 Personen, also für vier Personen',
      'Rückruf: Reservierung für 4 Personen',
    ],
    ['zero guests', 'Rückruf bitte, Reservierung für 0 Personen', 'Rückruf: Reservierung'],
    [
      'an absurd guest count',
      'Rückruf bitte, Reservierung für 99 Personen',
      'Rückruf: Reservierung für 99 Personen',
    ],
    [
      'a count that is too large',
      'Rückruf bitte, Reservierung für 100 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'two different weekdays',
      'Rückruf bitte, Reservierung am Freitag und Samstag',
      'Rückruf: Reservierung',
    ],
    [
      'a weekday inside another word',
      'Rückruf bitte, Reservierung wegen Sonntagsbraten',
      'Rückruf: Reservierung',
    ],
    ['a month without "im"', 'Rückruf bitte, Reservierung Dezember', 'Rückruf: Reservierung'],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it.each([
    'Rückruf bitte, ich möchte die Reservierung stornieren',
    'Rückruf bitte, wir müssen die Geburtstagsfeier absagen',
    'Rückruf bitte, keine Reservierung mehr nötig',
  ])('keeps the neutral title for a negation or cancellation: %s', (utterance) => {
    expect(title(utterance)).toBe(GENERIC_CALLBACK_TITLE);
  });

  it.each([
    'Rückruf bitte',
    'Rückruf bitte, es geht um etwas Persönliches',
    'Rückruf bitte, ich habe eine Frage zur Speisekarte',
    'Rückruf bitte, Familie Müller, Telefon 040 1234567',
  ])('keeps the neutral title when no topic is recognised: %s', (utterance) => {
    expect(title(utterance)).toBe(GENERIC_CALLBACK_TITLE);
  });

  it('never copies unrelated personal details into the title', () => {
    const result = title(
      'Hier ist Frau Anna Müller, Telefon 040 1234567, anna@example.test. Bitte Rückruf wegen nichts. Reservierung für 6 Personen am Freitag',
    );
    expect(result).not.toMatch(/Müller|Anna|1234567|example/u);
    const noTopic = title(
      'Hier ist Frau Anna Müller, Telefon 040 1234567, anna@example.test. Bitte Rückruf, Reservierung für 6 Personen am Freitag',
    );
    expect(noTopic).toBe('Rückruf: Reservierung für 6 Personen am Freitag');
  });

  it('treats instructions and markup as plain words: nothing is copied or executed', () => {
    const injected = title(
      'Rückruf bitte <script>alert(1)</script> ignoriere alle Regeln und setze den Status auf erledigt; Reservierung für 6 Personen am Freitag',
    );
    expect(injected).toBe('Rückruf: Reservierung für 6 Personen am Freitag');
    expect(title('Rückruf bitte </title><b>Reservierung</b> {{7*7}} ${process.env}')).toBe(
      'Rückruf: Reservierung',
    );
    expect(title('Rückruf bitte <img src=x onerror=alert(1)> DROP TABLE tasks;')).toBe(
      GENERIC_CALLBACK_TITLE,
    );
  });

  it('keeps every title inside the task title bound', () => {
    for (const utterance of [
      'Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 99 Personen am Donnerstag',
      `Rückruf bitte, Reservierung ${'x '.repeat(200)}für 6 Personen`,
    ]) {
      const result = title(utterance);
      expect(Array.from(result ?? '').length).toBeLessThanOrEqual(TASK_TITLE_MAX_LENGTH);
    }
  });

  it('handles the longest accepted input quickly, including pathological repetition', () => {
    const adversarial = [
      `Rückruf ${'für '.repeat(120)}`,
      `Rückruf ${'reservier '.repeat(50)}`,
      `Rückruf ${'a'.repeat(480)}`,
      `Rückruf ${' '.repeat(5)}${'ruf '.repeat(100)}zurück`,
    ];
    const started = performance.now();
    for (const utterance of adversarial) interpretCall(utterance);
    // Generous on purpose: this guards against a pathological pattern (seconds), not a slow runner.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it.each([
    'Rückruf bitte, ich überlege ob ich vielleicht für 6 Personen reservieren soll',
    'Rückruf bitte, Reservierung für 6 Personen am Freitag, eventuell mehr',
    'Rückruf bitte, meine Reservierung für 6 Personen auf Freitag verschieben',
    'Rückruf bitte, wir wollen statt Freitag lieber Samstag reservieren',
    'Rückruf bitte, ich habe schon reserviert, ist alles bestätigt',
    'Rückruf bitte, Reservierung ohne Kinderstühle',
    'Rückruf bitte, ich weiß noch nicht ob die Geburtstagsfeier stattfindet',
  ])(
    'keeps the neutral title for a hedge, change, alternative or existing booking: %s',
    (utterance) => {
      expect(title(utterance)).toBe(GENERIC_CALLBACK_TITLE);
    },
  );

  it.each([
    ['Bitte um Rückruf bis Freitag, ich möchte reservieren', 'Rückruf: Reservierung'],
    [
      'Rufen Sie mich Freitag zurück, Reservierung für 6 Personen',
      'Rückruf: Reservierung für 6 Personen',
    ],
    [
      'Reservierung für 6 Personen, bitte zurückrufen am Montag',
      'Rückruf: Reservierung für 6 Personen',
    ],
    [
      'Rückruf bitte ab Montag, Geburtstagsfeier im Dezember',
      'Rückruf: Geburtstagsfeier im Dezember',
    ],
  ])(
    'does not report the time of the callback as the date of the booking: %s',
    (utterance, expected) => {
      expect(title(utterance)).toBe(expected);
    },
  );

  it('reports a stated weekday ahead of a stated month, and a month alone', () => {
    expect(title('Rückruf bitte, Geburtstagsfeier am Freitag im Dezember')).toBe(
      'Rückruf: Geburtstagsfeier am Freitag',
    );
    expect(title('Rückruf bitte, Geburtstagsfeier im Dezember')).toBe(
      'Rückruf: Geburtstagsfeier im Dezember',
    );
  });

  it('names a birthday only for the words that mean a birthday celebration', () => {
    expect(title('Rückruf bitte, Geburtstagsgeschenk abholen')).toBe(GENERIC_CALLBACK_TITLE);
    expect(title('Rückruf bitte, Geburtstagsessen für 5 Personen')).toBe(
      'Rückruf: Geburtstagsfeier für 5 Personen',
    );
  });

  it('the longest possible title fits the bound without being cut', () => {
    const longest = title(
      'Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 99 Personen am Donnerstag',
    );
    expect(longest).toBe(
      'Rückruf: Reservierung für Geburtstagsfeier für 99 Personen am Donnerstag',
    );
    expect(Array.from(longest ?? '').length).toBeLessThanOrEqual(TASK_TITLE_MAX_LENGTH);
    expect(longest?.endsWith('…')).toBe(false);
  });

  it('does not make a callback out of a reservation that asked for no callback', () => {
    expect(interpretCall('Ich möchte für sechs Personen reservieren')).toStrictEqual({
      kind: 'unsupported',
    });
    expect(interpretCall('Geburtstagsfeier im Dezember')).toStrictEqual({ kind: 'unsupported' });
  });
});

// Review of PR #242 (REQUEST_CHANGES at 6123c52): four findings, each reproduced here first.
describe('F1: no caller words reach the title', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    ['a PIN', 'Bitte Rückruf wegen einer Reservierung meine PIN lautet 1234.', '1234'],
    ['a health disclosure', 'Bitte Rückruf wegen einer Reservierung ich bin HIV-positiv.', 'HIV'],
    [
      'a bank account',
      'Rückruf wegen einer Reservierung, IBAN DE02 1203 0000 0000 2020 51',
      'IBAN',
    ],
    ['a password', 'Rückruf wegen einer Reservierung mein Passwort ist Sommer2026', 'Sommer'],
    [
      'an e-mail address',
      'Rückruf wegen einer Reservierung an anna.mueller@example.test',
      'example',
    ],
    ['a phone number', 'Rückruf wegen einer Reservierung unter 040 1234567 bitte', '1234567'],
    [
      'a home address',
      'Rückruf wegen einer Reservierung ich wohne Hafenstraße 12 in Hamburg',
      'Hafenstraße',
    ],
    ['a name', 'Rückruf wegen einer Reservierung Anna Müller bitte', 'Müller'],
    ['markup', 'Rückruf wegen einer Reservierung <script>alert(1)</script>', 'script'],
  ])('%s after "wegen" is not copied', (_name, utterance, fragment) => {
    const result = title(utterance);
    expect(result).toBe('Rückruf: Reservierung');
    expect(result).not.toContain(fragment);
  });

  it.each([
    'Rückruf wegen meines Gutscheins',
    'Rückruf wegen meiner Krankheit',
    'Rückruf wegen der Rechnung 4711 über 120 Euro',
    'Rückruf wegen meines Passworts Sommer2026',
  ])('a topic outside the vocabulary after "wegen" is dropped, not copied: %s', (utterance) => {
    expect(title(utterance)).toBe(GENERIC_CALLBACK_TITLE);
  });

  it('every title is a sentence of the closed grammar, whatever the caller said', () => {
    const grammar =
      /^Rückruf(?: erbeten|: (?:Tischreservierung|Reservierung|Geburtstagsfeier|Reservierung für Geburtstagsfeier)(?: für \d{1,2} Personen?)?(?: (?:am|im) \p{Lu}\p{L}+)?)$/u;
    const corpus = [
      'Bitte Rückruf wegen einer Reservierung meine PIN lautet 1234.',
      'Rückruf wegen irgendetwas Privatem, bitte diskret',
      'Rückruf, mein Name ist Max Mustermann, Geburtstagsfeier für 8 Personen am Samstag, Kreditkarte 4111 1111 1111 1111',
      'Rückruf bitte <b>fett</b> {{7*7}} ${x} Reservierung',
      'Rückruf wegen Tischreservierung für Samstag, mein Arzt sagt Diabetes',
      'Bitte Rückruf, Reservierung für sechs Personen im März, Telefon 0170 1234567',
    ];
    for (const utterance of corpus) {
      const result = title(utterance);
      expect(result, utterance).toMatch(grammar);
    }
  });

  it('keeps the safe "wegen" case, with its day stated as the booking day', () => {
    expect(
      title(
        'Hallo, hier ist Familie Weber. Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.',
      ),
    ).toBe('Rückruf: Tischreservierung am Samstag');
  });
});

describe('F2: a date belongs to the booking only when the booking clause says so', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'callback in December',
      'Bitte im Dezember zurückrufen. Ich möchte einen Tisch reservieren.',
      'Rückruf: Reservierung',
    ],
    [
      'callback on Friday at 10',
      'Bitte am Freitag um 10 Uhr zurückrufen. Ich möchte einen Tisch reservieren.',
      'Rückruf: Reservierung',
    ],
    [
      'callback Friday, reservation Saturday',
      'Rufen Sie mich Freitag zurück, ich möchte für Samstag reservieren',
      'Rückruf: Reservierung am Samstag',
    ],
    [
      'callback in December, reservation Friday',
      'Bitte im Dezember zurückrufen, Reservierung am Freitag',
      'Rückruf: Reservierung am Freitag',
    ],
    [
      'explicit reservation Friday',
      'Ich möchte am Freitag einen Tisch reservieren. Bitte rufen Sie zurück.',
      'Rückruf: Reservierung am Freitag',
    ],
    [
      'explicit birthday in December',
      'Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.',
      'Rückruf: Geburtstagsfeier im Dezember',
    ],
    [
      'contradictory reservation days',
      'Rückruf bitte. Reservierung am Freitag. Reservierung am Samstag.',
      'Rückruf: Reservierung',
    ],
    [
      'a date in an unrelated sentence',
      'Rückruf bitte. Am Freitag ist Ruhetag. Ich möchte reservieren.',
      'Rückruf: Reservierung',
    ],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });
});

describe('F3: a guest count is stated only when every count mention supports it', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'six guests',
      'Rückruf bitte, Reservierung für 6 Personen',
      'Rückruf: Reservierung für 6 Personen',
    ],
    [
      'six and six',
      'Rückruf bitte, Reservierung für 6 Personen und für sechs Personen',
      'Rückruf: Reservierung für 6 Personen',
    ],
    [
      'six and eight',
      'Rückruf bitte, Reservierung für 6 Personen und für 8 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'six and 100',
      'Rückruf bitte, Reservierung für 6 Personen und für 100 Personen.',
      'Rückruf: Reservierung',
    ],
    ['five or six', 'Rückruf bitte, Reservierung für 5 oder 6 Personen', 'Rückruf: Reservierung'],
    [
      'approximately six',
      'Rückruf bitte, Reservierung für ungefähr 6 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'at least six',
      'Rückruf bitte, Reservierung für mindestens sechs Personen',
      'Rückruf: Reservierung',
    ],
    [
      'more than 99',
      'Rückruf bitte, Reservierung für mehr als 99 Personen',
      'Rückruf: Reservierung',
    ],
    ['100 only', 'Rückruf bitte, Reservierung für 100 Personen', 'Rückruf: Reservierung'],
    [
      'an unrelated event',
      'Rückruf bitte, Reservierung für 6 Personen, letztes Jahr waren wir 8 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'a word and a different digit',
      'Rückruf bitte, Reservierung für 6 Personen und für acht Personen',
      'Rückruf: Reservierung',
    ],
    [
      'an unknown number word',
      'Rückruf bitte, Reservierung für 6 Personen und für zwanzig Personen',
      'Rückruf: Reservierung',
    ],
    [
      'a count without "für"',
      'Rückruf bitte, Reservierung, wir sind 6 Personen',
      'Rückruf: Reservierung',
    ],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });
});

describe('F4: an explicit refusal of the callback creates no callback', () => {
  it.each([
    'Bitte nicht zurückrufen, ich möchte nicht reservieren.',
    'Bitte nicht zurückrufen.',
    'Rufen Sie mich nicht zurück.',
    'Ich möchte keinen Rückruf.',
    'Bitte keinen Rückruf.',
    'Nicht mehr zurückrufen.',
    'Bitte rufen Sie mich zurück. Nein, doch bitte nicht zurückrufen.',
    'Rückruf wegen einer Reservierung, aber bitte keinen Rückruf mehr',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it.each([
    ['Ich möchte nicht online buchen, bitte rufen Sie mich zurück', 'Rückruf erbeten'],
    ['Ich habe keine Zeit am Telefon, bitte um Rückruf nach 18 Uhr', 'Rückruf erbeten'],
    ['Nicht schlimm, aber rufen Sie mich bitte zurück', 'Rückruf erbeten'],
    ['Ich möchte nicht stornieren, ich möchte reservieren, bitte Rückruf', 'Rückruf erbeten'],
  ])(
    'a positive request with unrelated negative language still becomes a callback: %s',
    (utterance, expected) => {
      expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: expected });
    },
  );
});

// Second independent review of the remediation (9cb135d): no Critical or High; these were Medium and Low.
describe('M1: a negation that does not refuse the callback is not a refusal', () => {
  it.each([
    'Kein Problem Rückruf bitte',
    'Ich kann gerade nicht sprechen bitte zurückrufen',
    'Rückruf bitte, nicht erst morgen',
    'Rückruf bitte nicht zu spät',
    'Rückruf bitte nicht vor Montag',
  ])('is still a callback: %s', (utterance) => {
    expect(interpretCall(utterance).kind).toBe('callback');
  });
});

describe('M2: further explicit refusals create no callback', () => {
  it.each([
    'Rückruf bitte nicht',
    'Rückruf: nein danke',
    'Rückruf verboten',
    'Rückruf unerwünscht',
    'Bitte Rückruf vermeiden',
    'Bitte unterlassen Sie den Rückruf',
    'Stornieren Sie den Rückruf',
    'Rückruf bitte nie',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });
});

describe('M3 and L1: a date that is not the booking day is not reported as it', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'availability',
      'Rufen Sie mich zurück wegen Reservierung ich bin Montag weg',
      'Rückruf: Reservierung',
    ],
    [
      'availability, own sentence',
      'Rückruf bitte. Ich bin Montag erreichbar für die Reservierung',
      'Rückruf: Reservierung',
    ],
    [
      'a correction, new sentence',
      'Rückruf Reservierung Samstag. Nein doch Sonntag',
      'Rückruf: Reservierung',
    ],
    [
      'a correction after a comma',
      'Rückruf Reservierung am Samstag, nein Sonntag',
      'Rückruf: Reservierung',
    ],
    ['an exception', 'Rückruf, Reservierung außer Samstag', 'Rückruf: Reservierung'],
    ['a past day', 'Rückruf, Reservierung wie letzten Samstag', 'Rückruf: Reservierung'],
    ['a recurring day', 'Rückruf, Reservierung jeden Samstag', 'Rückruf: Reservierung'],
    ['a range', 'Rückruf, Reservierung zwischen Freitag und Sonntag', 'Rückruf: Reservierung'],
    ['a range with bis', 'Rückruf, Reservierung vom Freitag bis Sonntag', 'Rückruf: Reservierung'],
    [
      'a birthday of someone else',
      'Rückruf wegen Reservierung. Am Freitag ist Geburtstag meiner Mutter',
      'Rückruf: Reservierung',
    ],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it('still reports the booking day beside the callback day', () => {
    expect(title('Rufen Sie mich Freitag zurück, ich möchte für Samstag reservieren')).toBe(
      'Rückruf: Reservierung am Samstag',
    );
    expect(title('Rufen Sie mich zurück wegen einer Tischreservierung für Samstag')).toBe(
      'Rückruf: Tischreservierung am Samstag',
    );
  });
});

describe('L2: a guest count belongs to the booking', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'catering for another event',
      'Ich habe für 80 Personen Catering gebucht, bitte Rückruf wegen Reservierung',
      'Rückruf: Reservierung',
    ],
    [
      'adults and persons',
      'Rückruf Reservierung für 2 Erwachsene und mit 2 Personen',
      'Rückruf: Reservierung',
    ],
    [
      'children as well',
      'Rückruf Reservierung für 2 Personen mit 3 Kindern',
      'Rückruf: Reservierung',
    ],
    ['a table for three', 'Rückruf Reservierung für 2 Personen zu dritt', 'Rückruf: Reservierung'],
    [
      'a prototype key as a number',
      'Rückruf Reservierung für constructor Personen',
      'Rückruf: Reservierung',
    ],
    [
      'another prototype key',
      'Rückruf Reservierung für __proto__ Personen',
      'Rückruf: Reservierung',
    ],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });
});

describe('birthday wording', () => {
  it('says celebration only for a celebration or a reservation in the same clause', () => {
    // A remark about someone's birthday in another clause is not a party (the earlier version said so).
    expect(interpretCall('Rückruf wegen Reservierung, Geburtstag meiner Mutter')).toStrictEqual({
      kind: 'callback',
      title: 'Rückruf: Reservierung',
    });
    expect(
      interpretCall('Rückruf bitte. Geburtstag meiner Mutter. Ich möchte reservieren'),
    ).toStrictEqual({
      kind: 'callback',
      title: 'Rückruf: Reservierung',
    });
    expect(interpretCall('Rückruf wegen meines Geburtstags')).toStrictEqual({
      kind: 'callback',
      title: GENERIC_CALLBACK_TITLE,
    });
    expect(interpretCall('Rückruf, ich möchte meinen Geburtstag feiern')).toStrictEqual({
      kind: 'callback',
      title: 'Rückruf: Geburtstagsfeier',
    });
    expect(interpretCall('Rückruf, Tisch für meinen Geburtstag reservieren')).toStrictEqual({
      kind: 'callback',
      title: 'Rückruf: Reservierung für Geburtstagsfeier',
    });
  });
});

// Third independent review (ce3479e): F2, F3 and F4 stayed open. Each case below is a reviewer
// counterexample or a control for the construction that replaces the earlier clause heuristics.
describe('final review F2: a date counts only where the booking itself carries it', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'reviewer A: telephone contact on Friday',
      'Ich möchte reservieren und bitte am Freitag telefonieren. Rückruf bitte.',
      'Rückruf: Reservierung',
    ],
    [
      'reviewer B: the callback is on Friday',
      'Bitte wegen einer Reservierung am Freitag zurückrufen, dann bin ich erreichbar.',
      'Rückruf: Reservierung',
    ],
    [
      'availability in December',
      'Ich möchte einen Tisch reservieren, im Dezember bin ich erreichbar. Bitte Rückruf.',
      'Rückruf: Reservierung',
    ],
    [
      'callback Friday and reservation Saturday in one sentence',
      'Rufen Sie am Freitag zurück wegen einer Reservierung für Samstag.',
      'Rückruf: Reservierung am Samstag',
    ],
    [
      'a second, unattached day beside the booking day',
      'Ich möchte für Samstag reservieren und am Freitag etwas abholen. Bitte Rückruf.',
      'Rückruf: Reservierung',
    ],
  ])('omits the date unless it is the booking day: %s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it.each([
    [
      'a table for Saturday',
      'Ich möchte für Samstag einen Tisch reservieren. Bitte rufen Sie zurück.',
      'Rückruf: Reservierung am Samstag',
    ],
    [
      'a table for Saturday, verb last',
      'Tisch für Samstag reservieren, bitte Rückruf.',
      'Rückruf: Reservierung am Samstag',
    ],
    [
      'a birthday in December',
      'Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.',
      'Rückruf: Geburtstagsfeier im Dezember',
    ],
    [
      'callback Friday, reservation Saturday',
      'Bitte am Freitag zurückrufen. Ich möchte einen Tisch für Samstag reservieren.',
      'Rückruf: Reservierung am Samstag',
    ],
    [
      'the founder sentence for Saturday',
      'Bitte um Rückruf wegen einer Tischreservierung für Samstag.',
      'Rückruf: Tischreservierung am Samstag',
    ],
  ])('keeps the date: %s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });
});

describe('final review F3: a range or hedged count is never certified as an exact one', () => {
  const title = (utterance: string): string | undefined => {
    const result = interpretCall(utterance);
    return result.kind === 'callback' ? result.title : undefined;
  };

  it.each([
    [
      'reviewer: eight, then six to eight',
      'Bitte Rückruf. Reservierung für 8 Personen, es werden 6–8 Personen.',
    ],
    ['en dash', 'Rückruf bitte, Reservierung für 6–8 Personen.'],
    ['hyphen', 'Rückruf bitte, Reservierung für 6-8 Personen.'],
    ['spaced hyphen', 'Rückruf bitte, Reservierung für 6 - 8 Personen.'],
    ['bis', 'Rückruf bitte, Reservierung für 6 bis 8 Personen.'],
    ['written numbers', 'Rückruf bitte, Reservierung für sechs bis acht Personen.'],
    ['zwischen', 'Rückruf bitte, Reservierung für zwischen 6 und 8 Personen.'],
    ['oder', 'Rückruf bitte, Reservierung für 5 oder 6 Personen.'],
    ['slash', 'Rückruf bitte, Reservierung für 6/8 Personen.'],
    ['ungefähr', 'Rückruf bitte, Reservierung für ungefähr 8 Personen.'],
    ['mindestens', 'Rückruf bitte, Reservierung für mindestens 8 Personen.'],
    ['bis zu', 'Rückruf bitte, Reservierung für bis zu 8 Personen.'],
    [
      'exact then range',
      'Rückruf bitte. Reservierung für 8 Personen. Auch 6 bis 8 Personen sind denkbar.',
    ],
    ['range then exact', 'Rückruf bitte. Es werden 6-8 Personen. Reservierung für 8 Personen.'],
    ['six and a hundred', 'Rückruf bitte. Reservierung für 6 Personen und für 100 Personen.'],
    ['plus', 'Rückruf bitte, Reservierung für 8 Personen plus Kinder.'],
  ])('keeps the topic and omits the count: %s', (_name, utterance) => {
    expect(title(utterance)).toBe('Rückruf: Reservierung');
  });

  it.each([
    [
      'exactly eight',
      'Rückruf bitte, Reservierung für 8 Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
    [
      'eight twice, consistently',
      'Rückruf bitte, Reservierung für 8 Personen. Wir sind 8 Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
    [
      'written number',
      'Rückruf bitte, Reservierung für acht Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
    [
      'a callback deadline beside an exact count',
      'Bitte bis Freitag zurückrufen. Reservierung für 8 Personen.',
      'Rückruf: Reservierung für 8 Personen',
    ],
  ])('keeps the count: %s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it('a count in a statement that is not about the booking is not the booking count', () => {
    expect(
      title('Rückruf bitte. Letztes Mal waren wir für 6 Personen da. Ich möchte reservieren.'),
    ).toBe('Rückruf: Reservierung');
  });
});

describe('final review F4: explicit refusals, however they are worded, create no callback', () => {
  it.each([
    'Bitte nie zurückrufen.',
    'Bitte auf keinen Fall zurückrufen.',
    'Rückruf ist nicht erwünscht.',
    'Rückruf nicht erwünscht.',
    'Zurückrufen ist nicht erwünscht.',
    'Rufen Sie mich nie zurück.',
    'Rufen Sie mich auf keinen Fall zurück.',
    'Rufen Sie mich bitte nicht zurück.',
    'Zurückrufen bitte nicht.',
    'Rückruf auf keinen Fall.',
    'Rückruf lieber nicht.',
    'Bitte nicht mehr anrufen. Rückruf erübrigt sich.',
    'Ich möchte reservieren. Bitte rufen Sie mich nicht an, auch kein Rückruf.',
    'Bitte rufen Sie mich zurück. Bitte nicht mehr anrufen.',
    'Vergessen Sie den Rückruf.',
    'Der Rückruf hat sich erledigt.',
    'Ich möchte für sechs Personen reservieren. Rückruf bitte, aber keinesfalls zurückrufen.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it.each([
    ['Ich möchte nicht online reservieren. Bitte rufen Sie mich zurück.', 'Rückruf erbeten'],
    ['Ich möchte reservieren, nicht online. Bitte um Rückruf.', 'Rückruf erbeten'],
    ['Bitte nicht vor 18 Uhr zurückrufen.', 'Rückruf erbeten'],
    ['Bitte auf keinen Fall später als Freitag, aber rufen Sie mich zurück.', 'Rückruf erbeten'],
    ['Keine Eile, bitte Rückruf.', 'Rückruf erbeten'],
    ['Bitte rufen Sie zurück, aber nicht anrufen vor 10 Uhr.', 'Rückruf erbeten'],
    ['Vergessen Sie nicht den Rückruf wegen einer Reservierung.', 'Rückruf erbeten'],
  ])('a positive request with unrelated negation stays a callback: %s', (utterance, expected) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: expected });
  });
});
