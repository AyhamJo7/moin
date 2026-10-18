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
    ['Können Sie mich zurückrufen? Es geht wegen meines Gutscheins', 'Rückruf: Gutscheins'],
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

  it('keeps the title within the tasks.title bound, cutting on a character', () => {
    const result = interpretCall(`Rückruf wegen ${'Ä'.repeat(100)}`);
    expect(result.kind).toBe('callback');
    const title = result.kind === 'callback' ? result.title : '';
    expect(Array.from(title)).toHaveLength(TASK_TITLE_MAX_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });

  it('counts characters, not UTF-16 units: an emoji topic fits the title and the contract', () => {
    const result = interpretCall(`Rückruf wegen ${'🎂'.repeat(100)}`);
    const title = result.kind === 'callback' ? result.title : '';
    expect(Array.from(title)).toHaveLength(TASK_TITLE_MAX_LENGTH);
    expect(title.length).toBeGreaterThan(TASK_TITLE_MAX_LENGTH);
    expect(
      todayTaskSchema.shape.title.safeParse(title).success,
      'contract accepts what the database accepts',
    ).toBe(true);
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
      'Rückruf: Tischreservierung für Samstag',
    ],
    // Other ordinary phrasings.
    [
      'Rückruf bitte: Tischreservierung für 4 Gäste am Samstag',
      'Rückruf: Reservierung für 4 Personen am Samstag',
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
    expect(title('bitte zurückrufen...geburtstagsfeier,im  dezember')).toBe(
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
      'Rückruf: Sonntagsbraten',
    ],
    ['a month without "im"', 'Rückruf bitte, Reservierung Dezember', 'Rückruf: Reservierung'],
  ])('%s', (_name, utterance, expected) => {
    expect(title(utterance)).toBe(expected);
  });

  it.each([
    'Bitte nicht zurückrufen, ich möchte nicht reservieren',
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
    'Rückruf bitte, Reservierung für 4 oder 6 Personen',
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
    ['Rückruf bitte ab Montag, Geburtstagsfeier im Dezember', 'Rückruf: Geburtstagsfeier'],
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
