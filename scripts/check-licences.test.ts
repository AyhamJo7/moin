import { describe, expect, it } from 'vitest';
import { evaluate } from './check-licences.ts';

const allowed = (licence: string): boolean => evaluate('pkg', licence) === undefined;

describe('licence allowlist (QG-11)', () => {
  it('allows permissive licences', () => {
    for (const licence of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'CC0-1.0']) {
      expect(allowed(licence), licence).toBe(true);
    }
  });

  // The distinction that does the work: an obligation we can meet is acceptable; one that would
  // require publishing this product's source is not.
  it('allows LGPL but refuses AGPL', () => {
    expect(allowed('LGPL-3.0-or-later'), 'LGPL attaches on distribution, not on hosting').toBe(
      true,
    );
    expect(allowed('AGPL-3.0'), 'AGPL’s network clause reaches a hosted service').toBe(false);
    expect(evaluate('pkg', 'AGPL-3.0')?.reason).toMatch(/network/i);
  });

  it('refuses strong copyleft and source-available licences', () => {
    for (const licence of [
      'GPL-3.0',
      'GPL-2.0',
      'SSPL-1.0',
      'BUSL-1.1',
      'Elastic-2.0',
      'CC-BY-NC-4.0',
    ]) {
      expect(allowed(licence), licence).toBe(false);
    }
  });

  // A dependency whose licence cannot be determined is one whose obligations cannot be met.
  it('refuses an undetermined licence rather than warning about it', () => {
    for (const licence of ['', 'UNKNOWN', 'UNLICENSED', 'SEE LICENSE IN COPYING']) {
      expect(allowed(licence), JSON.stringify(licence)).toBe(false);
    }
    expect(evaluate('pkg', 'UNKNOWN')?.reason).toMatch(/cannot be determined/);
  });

  it('accepts a disjunction when any term is allowed, because we may choose that term', () => {
    expect(allowed('MIT OR GPL-3.0')).toBe(true);
    expect(allowed('(MIT OR Apache-2.0)')).toBe(true);
    expect(allowed('GPL-3.0 OR SSPL-1.0')).toBe(false);
  });

  it('requires every term of a conjunction to be allowed', () => {
    expect(allowed('MIT AND Apache-2.0')).toBe(true);
    expect(allowed('MIT AND GPL-3.0')).toBe(false);
  });

  it('explains why, not just that it refused', () => {
    expect(evaluate('pkg', 'SSPL-1.0')?.reason).toMatch(/not an open-source licence/);
    expect(evaluate('pkg', 'GPL-3.0')?.reason).toMatch(/copyleft/);
  });
});
