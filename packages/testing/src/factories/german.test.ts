import { describe, expect, it } from 'vitest';
import { Seeded, asciiFold, germanPerson, testLandlineNumber, testPhoneNumber } from './german.ts';

describe('German synthetic factories (INV-16)', () => {
  it('is deterministic, so a failing test can be reproduced from its seed', () => {
    expect(germanPerson(new Seeded(42))).toStrictEqual(germanPerson(new Seeded(42)));
  });

  it('produces different people from different seeds', () => {
    const a = germanPerson(new Seeded(1));
    const b = germanPerson(new Seeded(999));
    expect(`${a.fullName}${a.phone}`).not.toBe(`${b.fullName}${b.phone}`);
  });

  // The point of the reserved ranges: a fixture number that escapes into a real dialler must not
  // be able to reach a person.
  it('only ever generates numbers inside the reserved German test ranges', () => {
    const random = new Seeded(7);
    for (let i = 0; i < 500; i += 1) {
      expect(testPhoneNumber(random)).toMatch(/^\+49157\d{8}$/);
      expect(testLandlineNumber(random)).toMatch(/^\+49321\d{8}$/);
    }
  });

  it('uses only unroutable example domains for email', () => {
    const random = new Seeded(3);
    for (let i = 0; i < 200; i += 1) {
      expect(germanPerson(random).email).toMatch(/@example\.example$/);
    }
  });

  // A PLZ that starts with zero is the classic bug: treated as a number, 01067 becomes 1067.
  it('keeps leading zeros in postal codes', () => {
    const random = new Seeded(11);
    const codes = new Set<string>();
    for (let i = 0; i < 300; i += 1) codes.add(germanPerson(random).postalCode);
    expect([...codes].some((code) => code.startsWith('0'))).toBe(true);
    for (const code of codes) expect(code).toMatch(/^\d{5}$/);
  });

  it('includes names with umlauts and ß, which is where naive slugs break', () => {
    const random = new Seeded(5);
    const names = new Set<string>();
    for (let i = 0; i < 400; i += 1) names.add(germanPerson(random).fullName);
    expect([...names].some((name) => /[äöüÄÖÜß]/.test(name))).toBe(true);
  });

  // German convention is ue, not u — folding ü to u produces plausible addresses that match
  // nothing.
  it('folds German characters the way a person would type them', () => {
    expect(asciiFold('Müller')).toBe('mueller');
    expect(asciiFold('Groß')).toBe('gross');
    expect(asciiFold('Käthe')).toBe('kaethe');
    expect(asciiFold('Sören')).toBe('soeren');
    expect(asciiFold('Yılmaz')).toBe('yilmaz');
    // Letters NFD leaves intact would otherwise be deleted outright rather than folded.
    expect(asciiFold('Kowalczyk-Łukasz')).toBe('kowalczyklukasz');
    expect(asciiFold('Søren')).toBe('soeren');
    expect(asciiFold('Ægir')).toBe('aegir');
    // Letters NFD leaves intact would otherwise be deleted outright rather than folded.
    expect(asciiFold('Kowalczyk-Łukasz')).toBe('kowalczyklukasz');
    expect(asciiFold('Søren')).toBe('soeren');
    expect(asciiFold('Ægir')).toBe('aegir');
  });
});
