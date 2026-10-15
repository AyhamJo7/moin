/**
 * FAQ answering (P12.06.02/.04): verbatim answers, escalate-on-miss with
 * the uncertainty sentence, sensitive cards served verbatim through the
 * same path (their sole mode).
 */
import { describe, expect, it } from 'vitest';
import { answerFaq, FAQ_UNCERTAINTY } from './faq-answer.ts';

describe('faq answering', () => {
  it('speaks the approved answer verbatim (public + sensitive)', async () => {
    const lookup = {
      find: (q: string) =>
        Promise.resolve(
          q.includes('Lasagne')
            ? { spoken: 'Die Lasagne enthält Walnüsse.', stale: false }
            : { spoken: 'Montag bis Freitag elf bis zweiundzwanzig Uhr.', stale: false },
        ),
    };
    await expect(answerFaq('Öffnungszeiten?', lookup)).resolves.toStrictEqual({
      kind: 'answer',
      spoken: 'Montag bis Freitag elf bis zweiundzwanzig Uhr.',
    });
    await expect(answerFaq('Enthält die Lasagne Nüsse?', lookup)).resolves.toStrictEqual({
      kind: 'answer',
      spoken: 'Die Lasagne enthält Walnüsse.',
    });
  });

  it('escalates on miss with the uncertainty sentence (BR-129)', async () => {
    expect(FAQ_UNCERTAINTY).toContain('nicht zuverlässig');
    const turn = await answerFaq('Was ist der Sinn des Lebens?', {
      find: () => Promise.resolve(null),
    });
    expect(turn).toStrictEqual({ kind: 'escalate', reason: 'no-match' });
  });
});
