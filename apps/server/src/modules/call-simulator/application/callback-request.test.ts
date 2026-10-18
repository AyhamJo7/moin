import { describe, expect, it } from 'vitest';
import { TASK_TITLE_MAX_LENGTH, todayTaskSchema } from '@moin/contracts';
import {
  CALLBACK_TITLES,
  GENERIC_CALLBACK_TITLE,
  interpretCall,
  normaliseUtterance,
} from './callback-request.ts';

// Founder scope decision (PRODUCT-01, fifth review at 009b8ed): a callback title names the topic only,
// one of four constants. The earlier tests that expected a guest count, a weekday or a month in the
// title ("Rückruf: Reservierung für 6 Personen am Freitag", "Tischreservierung am Samstag", ...) were
// removed on purpose, because that capability is no longer offered; their inputs are kept below and
// in callback-request.properties.test.ts as assertions that no detail appears. "Tischreservierung"
// is now "Reservierung": the four titles are the whole vocabulary.

const RESERVATION = 'Rückruf: Reservierung';
const BIRTHDAY = 'Rückruf: Geburtstagsfeier';
const BOTH = 'Rückruf: Reservierung für Geburtstagsfeier';
const GENERIC = GENERIC_CALLBACK_TITLE;

const titleOf = (utterance: string): string => {
  const result = interpretCall(utterance);
  if (result.kind !== 'callback') throw new Error(`not a callback: ${utterance}`);
  return result.title;
};

describe('interpretCall: outcomes', () => {
  it.each(['Wann haben Sie heute geöffnet?', 'Ich möchte einen Tisch für vier Personen', 'zurück'])(
    'leaves other requests unsupported: %s',
    (utterance) => {
      expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
    },
  );

  it('does not make a callback out of a reservation that asked for no callback', () => {
    expect(interpretCall('Ich möchte für sechs Personen reservieren')).toStrictEqual({
      kind: 'unsupported',
    });
    expect(interpretCall('Geburtstagsfeier im Dezember')).toStrictEqual({ kind: 'unsupported' });
  });

  it('rejects empty, invisible-only and over-long utterances', () => {
    expect(interpretCall('')).toStrictEqual({ kind: 'invalid' });
    expect(interpretCall(' \u0000​\t ')).toStrictEqual({ kind: 'invalid' });
    expect(interpretCall(`Rückruf ${'a'.repeat(500)}`)).toStrictEqual({ kind: 'invalid' });
  });

  it('normalises to NFC and strips control and format characters', () => {
    expect(normaliseUtterance('  Rückruf\u0007 ​bitte\n\n ')).toBe('Rückruf bitte');
  });

  it('every one of the four titles fits the database bound and the Today contract', () => {
    expect(CALLBACK_TITLES).toStrictEqual([GENERIC, RESERVATION, BIRTHDAY, BOTH]);
    for (const title of CALLBACK_TITLES) {
      expect(Array.from(title).length).toBeLessThanOrEqual(TASK_TITLE_MAX_LENGTH);
      expect(todayTaskSchema.shape.title.safeParse(title).success).toBe(true);
    }
  });

  it('handles the longest accepted input quickly, including pathological repetition', () => {
    const adversarial = [
      `Rückruf ${'für '.repeat(120)}`,
      `Rückruf ${'reservier '.repeat(50)}`,
      `Rückruf ${'a'.repeat(480)}`,
      `Rückruf ${' '.repeat(5)}${'ruf '.repeat(100)}zurück`,
      `Rückruf ${'bitte '.repeat(80)}`,
      `rufen ${'sie '.repeat(110)}nicht zurück`,
      `Rückruf ${'vergessen sie '.repeat(30)}`,
    ];
    const started = performance.now();
    for (const utterance of adversarial) interpretCall(utterance);
    // Generous on purpose: this guards against a pathological pattern (seconds), not a slow runner.
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('category: the topic of the callback, one of four constant titles', () => {
  it.each([
    // The founder brief.
    ['Ich möchte für sechs Personen reservieren. Bitte um Rückruf.', RESERVATION],
    ['Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.', BIRTHDAY],
    ['Bitte um Rückruf wegen einer Tischreservierung für eine Geburtstagsfeier.', BOTH],
    // The founder rehearsal sentences.
    ['Bitte rufen Sie mich zurück, es geht um eine Geburtstagsfeier im Dezember.', BIRTHDAY],
    [
      'Guten Tag, ich möchte für sechs Personen am Freitagabend reservieren. Bitte um Rückruf.',
      RESERVATION,
    ],
    [
      'Hallo, hier ist Familie Weber. Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.',
      RESERVATION,
    ],
    // Other ordinary phrasings: positive controls for each category.
    ['Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.', RESERVATION],
    ['Bitte zurückrufen, ich möchte einen Tisch buchen', RESERVATION],
    ['Rückruf bitte: Tischreservierung für 4 Gäste am Samstag', RESERVATION],
    ['Wären Sie so nett, mich zurückzurufen? Es geht um eine Reservierung.', RESERVATION],
    ['Rückruf bitte, Geburtstagsessen für 5 Personen', BIRTHDAY],
    ['Rückruf, ich möchte meinen Geburtstag feiern', BIRTHDAY],
    ['Bitte rufen Sie mich zurück, wegen der Geburtstagsfeier am Samstag!', BIRTHDAY],
    ['Rückruf bitte, Geburtstagsfeier mit Tischreservierung für 12 Personen', BOTH],
    ['Rückruf, Tisch für meinen Geburtstag reservieren', BOTH],
    ['  RÜCKRUF   BITTE!!!   RESERVIERUNG\tFÜR   SECHS   PERSONEN   AM   SAMSTAG ', RESERVATION],
    ['BITTE   ZURÜCKRUFEN.   GEBURTSTAGSFEIER   IM   DEZEMBER', BIRTHDAY],
    ['bitte zurückrufen...geburtstagsfeier,im  dezember', BIRTHDAY],
  ])('%s → %s', (utterance, expected) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: expected });
  });

  it.each([
    'Rückruf bitte',
    'Ruf mich bitte zurück',
    'RÜCKRUF bitte',
    'Können Sie mich zurückrufen? Es geht wegen meines Gutscheins',
    'Rückruf bitte, es geht um etwas Persönliches',
    'Rückruf bitte, ich habe eine Frage zur Speisekarte',
    'Rückruf wegen meines Geburtstags',
    'Rückruf bitte, Geburtstagsgeschenk abholen',
  ])('no recognised topic gives the generic title: %s', (utterance) => {
    expect(titleOf(utterance)).toBe(GENERIC);
  });

  it.each([
    // Booking software and complaints are not a new reservation.
    'Bitte um Rückruf, die Online-Reservierung klappt nicht.',
    'Rückruf bitte, Ihr Reservierungssystem zeigt einen Fehler.',
    'Rückruf bitte, ich habe ein Problem mit der Reservierung.',
    'Rückruf bitte, ich möchte mich über die Reservierung beschweren.',
    'Rückruf bitte, die Reservierung über die App geht nicht.',
    // Cancellations, changes and existing or past bookings.
    'Rückruf bitte, ich möchte die Reservierung stornieren',
    'Rückruf bitte, wir müssen die Geburtstagsfeier absagen',
    'Rückruf bitte, meine Reservierung für 6 Personen auf Freitag verschieben',
    'Rückruf bitte, ich möchte eine Reservierung am Freitag auf acht Personen erhöhen',
    'Rückruf bitte, ich habe schon reserviert, ist alles bestätigt',
    'Ich habe eine Reservierung am Freitag. Bitte Rückruf.',
    'Bitte Rückruf wegen unserer Reservierung am Freitag.',
    'Rückruf wegen Reservierung am Freitag war das Essen kalt',
    'Rückruf bitte, ich habe eine Frage zur Reservierung',
    'Rückruf wegen Reservierungsstornierung für 4 Personen am Freitag',
    'Rückruf wegen Reservierungsänderung für 4 Personen am Samstag',
    // Doubt, alternatives, negation.
    'Rückruf bitte, ich überlege ob ich vielleicht für 6 Personen reservieren soll',
    'Rückruf bitte, Reservierung oder Abholung',
    'Rückruf bitte, Reservierung ohne Kinderstühle',
    'Ich möchte nicht online reservieren, bitte rufen Sie mich zurück.',
  ])(
    'an uncertain, changed, existing or complaint topic gives the generic title: %s',
    (utterance) => {
      expect(titleOf(utterance)).toBe(GENERIC);
    },
  );

  it('a birthday remark in another clause is not a celebration', () => {
    expect(titleOf('Rückruf wegen Reservierung, Geburtstag meiner Mutter')).toBe(RESERVATION);
    expect(titleOf('Rückruf bitte. Geburtstag meiner Mutter. Ich möchte reservieren')).toBe(
      RESERVATION,
    );
  });

  it('never states a callback request as a booking', () => {
    for (const title of CALLBACK_TITLES) {
      expect(title).not.toMatch(/reserviert|bestätigt|gebucht|zugesagt/iu);
    }
  });
});

describe('F1: no caller words reach the title', () => {
  it.each([
    ['a PIN', 'Bitte Rückruf wegen einer Reservierung meine PIN lautet 1234.'],
    ['a health disclosure', 'Bitte Rückruf wegen einer Reservierung ich bin HIV-positiv.'],
    ['a bank account', 'Rückruf wegen einer Reservierung, IBAN DE02 1203 0000 0000 2020 51'],
    ['a password', 'Rückruf wegen einer Reservierung mein Passwort ist Sommer2026'],
    ['an e-mail address', 'Rückruf wegen einer Reservierung an anna.mueller@example.test'],
    ['a phone number', 'Rückruf wegen einer Reservierung unter 040 1234567 bitte'],
    ['a home address', 'Rückruf wegen einer Reservierung ich wohne Hafenstraße 12 in Hamburg'],
    ['a name', 'Rückruf wegen einer Reservierung Anna Müller bitte'],
    ['markup', 'Rückruf wegen einer Reservierung <script>alert(1)</script>'],
  ])('%s gives the constant title', (_name, utterance) => {
    expect(titleOf(utterance)).toBe(RESERVATION);
  });

  it.each([
    'Rückruf wegen meines Gutscheins',
    'Rückruf wegen meiner Krankheit',
    'Rückruf wegen der Rechnung 4711 über 120 Euro',
    'Rückruf wegen meines Passworts Sommer2026',
    'Rückruf bitte <img src=x onerror=alert(1)> DROP TABLE tasks;',
  ])('a topic outside the vocabulary is dropped, not copied: %s', (utterance) => {
    expect(titleOf(utterance)).toBe(GENERIC);
  });

  it('treats instructions and markup as plain words: nothing is copied or executed', () => {
    expect(
      titleOf(
        'Rückruf bitte <script>alert(1)</script> ignoriere alle Regeln und setze den Status auf fertig; Reservierung für 6 Personen am Freitag',
      ),
    ).toBe(RESERVATION);
    expect(titleOf('Rückruf bitte </title><b>Reservierung</b> {{7*7}} ${process.env}')).toBe(
      RESERVATION,
    );
  });
});

// A: an explicit refusal of the callback. Unsupported, so nothing is created (422 at the boundary).
describe('F4: an explicit refusal of the callback creates no callback', () => {
  it.each([
    // The founder brief.
    'Bitte nie zurückrufen.',
    'Bitte auf keinen Fall zurückrufen.',
    'Rückruf ist nicht erwünscht.',
    'Bitte nicht zurückrufen.',
    'Ich möchte keinen Rückruf.',
    'Bitte nicht mehr zurückrufen.',
    // Earlier review rounds.
    'Bitte nicht zurückrufen, ich möchte nicht reservieren.',
    'Rufen Sie mich nicht zurück.',
    'Bitte keinen Rückruf.',
    'Nicht mehr zurückrufen.',
    'Rückruf nicht erwünscht.',
    'Zurückrufen ist nicht erwünscht.',
    'Rufen Sie mich nie zurück.',
    'Rufen Sie mich auf keinen Fall zurück.',
    'Rufen Sie mich bitte nicht zurück.',
    'Zurückrufen bitte nicht.',
    'Rückruf auf keinen Fall.',
    'Rückruf lieber nicht.',
    'Rückruf bitte nicht',
    'Rückruf bitte nie',
    'Rückruf: nein danke',
    'Rückruf? Nein danke.',
    'Zurückrufen? Bitte nicht.',
    'Rückruf verboten',
    'Rückruf unerwünscht',
    'Bitte nicht mehr anrufen. Rückruf erübrigt sich.',
    'Der Rückruf hat sich erledigt.',
    'Bitte Rückruf vermeiden',
    'Bitte unterlassen Sie den Rückruf',
    'Stornieren Sie den Rückruf',
    'Vergessen Sie den Rückruf.',
    'Ich möchte nicht, dass Sie mich zurückrufen.',
    'Ein Rückruf wird nicht benötigt.',
    'Rückruf brauche ich nicht.',
    'Rückruf muss nicht sein.',
    'Auf einen Rückruf kann ich gerne verzichten.',
    'Ich verzichte auf einen Rückruf.',
    'Weder Rückruf noch E-Mail bitte.',
    'Ein Rückruf kommt für mich nicht in Frage.',
    'Auf Rückrufe lege ich keinen Wert.',
    'Lassen Sie den Rückruf bitte sein.',
    'Ich rufe Sie später zurück wegen der Reservierung.',
    // Further common word orders (fifth review).
    'Ich möchte nicht zurückgerufen werden.',
    'Bitte rufen Sie mich nicht mehr an.',
    'Einen Rückruf möchte ich nicht.',
    'Kein Rückruf bitte.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });
});

// C: a request that asks for the callback and also refuses or takes it back. Contact consent cannot
// be established, so nothing is created.
describe('F4: a contradictory callback instruction fails conservatively', () => {
  it.each([
    'Bitte rufen Sie mich zurück. Nein, doch bitte nicht zurückrufen.',
    'Rückruf wegen einer Reservierung, aber bitte keinen Rückruf mehr',
    'Ich möchte reservieren. Bitte rufen Sie mich nicht an, auch kein Rückruf.',
    'Bitte rufen Sie mich zurück. Bitte nicht mehr anrufen.',
    'Ich möchte für sechs Personen reservieren. Rückruf bitte, aber keinesfalls zurückrufen.',
    'Bitte Rückruf. Lieber nicht.',
    'Bitte nicht anrufen, sondern zurückrufen.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });
});

// B: a positive callback request with negative wording that does not target the callback.
describe('F4: a negation that does not target the callback is not a refusal', () => {
  it.each([
    // The fifth review's counterexample and the founder brief.
    'Ich möchte nicht online reservieren, bitte rufen Sie mich zurück.',
    'Bitte zurückrufen, das Formular funktioniert nicht.',
    'Kein Problem Rückruf bitte',
    'Ich kann gerade nicht sprechen bitte zurückrufen',
    // Further word orders of the same kind.
    'Rückruf bitte, die Seite lädt nicht.',
    'Rückruf bitte weil die Bestätigung nicht ankam',
    'Bitte um Rückruf, ich komme online nicht weiter.',
    'Bitte zurückrufen, ich kann nicht online buchen.',
    'Rückruf bitte, das Formular geht doch nicht.',
    'Vergessen Sie bitte nicht zurückzurufen.',
    'Vergessen Sie nicht den Rückruf wegen einer Reservierung.',
    // Earlier review rounds.
    'Ich möchte nicht online buchen, bitte rufen Sie mich zurück',
    'Nicht schlimm, aber rufen Sie mich bitte zurück',
    'Ich möchte nicht stornieren, ich möchte reservieren, bitte Rückruf',
    'Rückruf bitte nicht zu spät',
    'Rückruf bitte nicht vor Montag',
    'Ich möchte reservieren, nicht online. Bitte um Rückruf.',
    'Bitte nicht vor 18 Uhr zurückrufen.',
    'Keine Eile, bitte Rückruf.',
    'Bitte rufen Sie zurück, aber nicht anrufen vor 10 Uhr.',
    'Bitte kein Rückruf vor zehn Uhr, danach gerne.',
    'Kein Rückruf morgen früh, danach gern.',
    'Ich habe versucht Sie zu erreichen. Bitte rufen Sie mich zurück. Ich rufe Sie sonst morgen an.',
  ])('stays a callback, with the generic title: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: GENERIC });
  });

  it('a positive control: unrelated negation elsewhere does not hide a plain topic', () => {
    expect(titleOf('Bitte um Rückruf wegen einer Reservierung.')).toBe(RESERVATION);
    expect(titleOf('Bitte um Rückruf denn die Onlinebuchung funktioniert.')).toBe(GENERIC);
  });
});

// Fresh adversarial review of c603a61 (121 new utterances). The refusal grammar was a closed list of
// phrases, so ordinary variants slipped past it. Negation is now scoped by clause: inside the clause
// that names the contact, any refusal word withholds consent; a clause that takes the request back
// refuses it. Each case below failed on c603a61.
describe('adversarial review: refusal variants the phrase list missed create no callback', () => {
  it.each([
    'Ruf mich ja nicht zurück!',
    'Wegen Rückruf: rufen Sie mich bloß nicht zurück.',
    'Bitte zurückrufen oder lieber doch nicht',
    'Rückruf bitte ach nee doch nicht',
    'Ich habe gesagt ich möchte keinen Rückruf bekommen',
    'Ich möchte nicht angerufen werden.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it.each([
    'Danke, dass Sie zurückgerufen haben, alles geklärt.',
    'Ihre Rückrufnummer funktioniert nicht.',
  ])('a mention that asks for nothing is not a callback request: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });
});

describe('adversarial review: a wanted callback beside a negation is kept', () => {
  it.each([
    'Sie haben mich nicht zurückgerufen, bitte rufen Sie mich zurück.',
    'Sie haben mich nie zurückgerufen. Bitte Rückruf.',
    'Ihr Kollege hat nicht zurückgerufen, bitte Rückruf.',
    'Bitte Rückruf nicht vergessen.',
    'Kein Rückruf nach 20 Uhr bitte, vorher gern.',
    'Rückruf bitte nicht am Wochenende.',
    'Danke für den Rückruf, bitte rufen Sie noch einmal zurück.',
  ])('stays a callback: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: GENERIC });
  });
});

// The price of denying consent by default, accepted on purpose: a negation that is not one of the
// recognised harmless constructions (technical fault, something the caller does not do, a real time
// limit, a reminder, a report of a missing callback, a set phrase) cannot be told from a refusal, so the
// request is unsupported and the caller asks again. Each of these was a callback before.
describe('conservative: a negation not recognised as harmless withholds consent', () => {
  it.each([
    'Ich kann Sie leider nicht anrufen, bitte rufen Sie mich zurück.',
    'Bitte heute nicht mehr zurückrufen, morgen gern',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });
});

// Second adversarial round (103 new utterances against the clause-scoped design): a refusal in a clause
// without a contact word, before the request, or hidden behind a time or report exemption still created
// a callback. Consent is now denied by default; each case failed on the clause-scoped design.
describe('second adversarial round: refusals however split or disguised create no callback', () => {
  it.each([
    'Rückruf? Ist nicht nötig.',
    'Rückruf? Auf keinen Fall.',
    'Rückruf? Keinesfalls.',
    'Rückruf? Niemals.',
    'Rückruf: nicht erwünscht.',
    'Rückruf, nicht gewünscht',
    'Ich möchte nicht, dass man mich anruft.',
    'Ich möchte nicht, dass mich jemand kontaktiert. Rückruf nein.',
    'Ich habe Ihre Nachricht erhalten kein Rückruf nötig',
    'Ich bin schon zurückgerufen worden kein Rückruf mehr',
    'Ihr Anruf kam ungelegen bitte nicht mehr zurückrufen',
    'Danke, ich wurde bereits zurückgerufen.',
    'Ihr Kollege hat mich schon zurückgerufen, alles gut.',
    'Ich brauche wie bisher keinen Rückruf.',
    'Bislang wollte ich keinen Rückruf und auch jetzt nicht.',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it.each([
    'Rückruf bitte, die Online-Reservierung klappt nicht.',
    'Bitte Rückruf, die Bestätigung kam nicht an.',
    'Bitte Rückruf. Nicht dringend.',
    'Rückruf bitte nicht vor neun.',
    'Bitte zurückrufen, ich bin morgen nicht erreichbar.',
    'Rückruf bitte, ich möchte die Reservierung stornieren.',
    'Gerne Rückruf, warum nicht.',
  ])('a recognised harmless negation keeps the callback: %s', (utterance) => {
    expect(interpretCall(utterance).kind).toBe('callback');
  });
});

describe('adversarial review: a change, cancellation, lost item or second booking is not a new topic', () => {
  it.each([
    'Rückruf bitte, ich will die Reservierung canceln.',
    'Rückruf bitte, die Reservierung rückgängig machen.',
    'Rückruf bitte, bitte die Reservierung löschen.',
    'Rückruf bitte, wir möchten die Reservierung verlegen.',
    'Rückruf bitte, Reservierung annullieren.',
    'Rückruf bitte, die Reservierung anpassen.',
    'Rückruf bitte, die Reservierung meines Mannes.',
    'Rückruf bitte, eine zweite Reservierung zusätzlich zur ersten.',
    'Rückruf bitte, die Reservierung ging verloren.',
    'Rückruf bitte, Doppelbuchung bei der Reservierung.',
    'Rückruf bitte, die Geburtstagsfeier canceln.',
    'Rückruf bitte, die Geburtstagsfeier fällt aus.',
    'Rückruf bitte, unsere Geburtstagsfeier verlegen.',
    'Rückruf bitte, die Reservierung umändern.',
    'Rückruf bitte, die Reservierung kündigen.',
    'Rückruf bitte, die Geburtstagsfeier ist ausgefallen.',
    'Rückruf bitte, die Geburtstagsfeier wurde verschoben.',
    'Rückruf bitte, gilt die Reservierung für Freitag noch?',
    'Rückruf bitte, Geburtstagsfeier: Essen kalt, Service schlecht.',
    'Rückruf bitte wegen der Reservierung, sehr enttäuscht.',
    'Rückruf bitte, Reservierung, die Rechnung war zu hoch.',
  ])('gives the generic title: %s', (utterance) => {
    expect(titleOf(utterance)).toBe(GENERIC);
  });

  it.each([
    ['Rückruf bitte, wir möchten Kindergeburtstag feiern.', BIRTHDAY],
    ['Rückruf bitte, machen Sie Geburtstagsfeiern?', BIRTHDAY],
    ['Rückruf bitte, ich möchte einen Tisch auf den Namen Müller reservieren.', RESERVATION],
  ])('positive control: %s → %s', (utterance, expected) => {
    expect(titleOf(utterance)).toBe(expected);
  });
});

// Third adversarial round (78 new utterances against deny-by-default): harmless constructions that were
// too broad ("nicht weiter", any noun before "stornieren", "vor 2027", every daypart excluded), reports
// read as requests, and refusals with no negation at all. Each case failed before this change.
describe('third adversarial round: disguised and negation-free refusals create no callback', () => {
  it.each([
    'Bisher kein Rückruf – und das ist auch gut so.',
    'Es kam kein Rückruf, und das passt mir gut.',
    'Rückruf ach vergiss es nicht nötig',
  ])('is unsupported: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'unsupported' });
  });

  it.each([
    'Bitte um Rückruf, weil die Onlinebuchung nicht funktioniert.',
    'Bitte zurückrufen, das Online-Formular funktioniert nicht richtig.',
    'Rückruf bitte, ich komme online nicht weiter.',
  ])('the founder positives and their variants stay callbacks: %s', (utterance) => {
    expect(interpretCall(utterance)).toStrictEqual({ kind: 'callback', title: GENERIC });
  });

  it.each([
    'Rückruf bitte, ich möchte die Reservierung zurücknehmen.',
    'Rückruf bitte, die Reservierung umstellen.',
    'Rückruf bitte, die Reservierung ist weg.',
    'Rückruf bitte, Geburtstagsfeier: zu laut, Nachbarn sauer.',
    'Rückruf bitte, Reservierung: Kellner frech.',
  ])('a change, loss or complaint gives the generic title: %s', (utterance) => {
    const result = interpretCall(utterance);
    expect(result.kind === 'callback' ? result.title : GENERIC).toBe(GENERIC);
  });
});
