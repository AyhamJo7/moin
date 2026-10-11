import { describe, expect, it } from 'vitest';
import { lintSpokenAnswer } from './spoken-lint.ts';

describe('spoken lint', () => {
  it('accepts clean short answers, with hints only for foreign names', () => {
    const clean = lintSpokenAnswer('Unsere Adresse lautet Hauptstraße 12, 20354 Hamburg.');
    expect(clean.ok).toBe(true);
    expect(clean.errors).toHaveLength(0);
    const hinted = lintSpokenAnswer('Herr Nguyen berät Sie gerne.');
    expect(hinted.ok).toBe(true);
    expect(hinted.hints.length).toBeGreaterThan(0);
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
