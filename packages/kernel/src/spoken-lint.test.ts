import { describe, expect, it } from 'vitest';
import { lintSpokenAnswer } from './spoken-lint.ts';

/** Long enough that the quadratic pattern took seconds; the linear check takes milliseconds. */
const LONG_RUN = 30_000;
const LINEAR_BUDGET_MS = 500;

describe('spoken lint', () => {
  it('accepts clean short answers, with hints only for foreign names', () => {
    const clean = lintSpokenAnswer('Unsere Adresse lautet Hauptstraße 12, 20354 Hamburg.');
    expect(clean.ok).toBe(true);
    expect(clean.errors).toHaveLength(0);
    const hinted = lintSpokenAnswer('Herr Nguyen berät Sie gerne.');
    expect(hinted.ok).toBe(true);
    expect(hinted.hints.length).toBeGreaterThan(0);
  });

  it.each([
    ['Herr Nguyen berät Sie gerne.', 'Nguyen'],
    ['Wir öffnen im Herbst wieder.', 'Herbst'],
    ['Wir liefern nach Hamburg.', null],
    ['Frau Schmidt ruft zurück.', null],
  ])('hints a phonetic spelling for %s', (text, word) => {
    const hints = lintSpokenAnswer(text).hints.join(' ');
    if (word === null) expect(hints).toBe('');
    else expect(hints).toContain(`"${word}"`);
  });

  // The foreign-name check used to backtrack quadratically on a capital followed by many "y" when
  // no word boundary follows (here a digit), so the match fails only after every split was tried.
  it('lints a long run of repeated letters in linear time', () => {
    const started = performance.now();
    lintSpokenAnswer(`A${'y'.repeat(LONG_RUN)}1`);
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('rejects URLs, long digit runs and overlong text', () => {
    expect(lintSpokenAnswer('Mehr unter https://example.de/preise.').ok).toBe(false);
    expect(lintSpokenAnswer('Mehr unter www.example.de.').ok).toBe(false);
    expect(lintSpokenAnswer('Rufen Sie 03012345678 an.').ok).toBe(false);
    expect(lintSpokenAnswer('x'.repeat(351)).ok).toBe(false);
    expect(lintSpokenAnswer('   ').ok).toBe(false);
  });

  it('accepts formatted numbers with separators or cue words', () => {
    expect(lintSpokenAnswer('Rufen Sie 030 123 456 an.').ok).toBe(true);
    expect(lintSpokenAnswer('Ihre Nummer 03012345 lautet.').ok).toBe(true);
  });

  it('rejects per-run: an innocent space elsewhere does not bless a long run', () => {
    expect(lintSpokenAnswer('PLZ 20500 12345678.').ok).toBe(false);
    expect(lintSpokenAnswer('PLZ 20500 123 456.').ok).toBe(true);
  });

  it('ties cues per-run: a distant cue does not bless an unreadable run', () => {
    expect(lintSpokenAnswer('Unsere Telefonnummer ist 030 123 456, Kundenkonto 987654.').ok).toBe(
      false,
    );
    expect(lintSpokenAnswer('Kundenkonto Nummer 987654 lautet.').ok).toBe(true);
  });
});
