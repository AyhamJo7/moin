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
