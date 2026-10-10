import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { phoneNumber } from './phone-number.ts';
import { emailAddress } from './email-address.ts';
import { postalCode } from './postal-code.ts';
import { personName } from './person-name.ts';
import { money, moneyFromEuros } from './money.ts';

describe('phoneNumber', () => {
  it('parses national DE input to E.164', () => {
    expect(phoneNumber('030 901820').e164).toBe('+4930901820');
  });

  it('treats national and international spellings as equal', () => {
    expect(phoneNumber('030 901820').equals(phoneNumber('+49 30 901820'))).toBe(true);
  });

  it('detects mobile and landline', () => {
    expect(phoneNumber('+49 151 23456789').kind).toBe('mobile');
    expect(phoneNumber('+49 30 901820').kind).toBe('landline');
  });

  it('formats national for display', () => {
    expect(phoneNumber('+4930901820').national()).toContain('030');
  });

  it('refuses garbage, empties and reserved ranges', () => {
    for (const raw of ['', 'abc', '123', '+49 900 123456', '+49 555 1234', '+1 555 0100']) {
      expect(() => phoneNumber(raw), raw).toThrow(RangeError);
    }
  });

  it('property: E.164 output always round-trips', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('+4930901820', '+4915123456789', '+498912345678', '+494012345678'),
        (e164) => {
          expect(phoneNumber(e164).e164).toBe(e164);
        },
      ),
    );
  });

  it('property: national spelling parses to the same E.164', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(['030 901820', '+49 30 901820'], ['0151 23456789', '+49 151 23456789']),
        ([national, international]) => {
          expect(phoneNumber(national).e164).toBe(phoneNumber(international).e164);
        },
      ),
    );
  });
});

describe('emailAddress', () => {
  it('lower-cases the domain and preserves the local part', () => {
    const parsed = emailAddress('Hans.Mueller@Example.COM');
    expect(parsed.value).toBe('Hans.Mueller@example.com');
    expect(parsed.local).toBe('Hans.Mueller');
    expect(parsed.domain).toBe('example.com');
  });

  it('does no provider-specific folding', () => {
    expect(emailAddress('h.m@mail.de').equals(emailAddress('hm@mail.de'))).toBe(false);
  });

  it('refuses malformed input', () => {
    for (const raw of ['', 'no-at', '@x.de', 'a@b', 'a b@c.de']) {
      expect(() => emailAddress(raw), raw).toThrow(RangeError);
    }
  });

  it('property: value round-trips through parse', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.stringMatching(/^[a-zA-Z0-9._-]{1,20}$/),
            fc.constantFrom('example.de', 'betrieb.com', 'kanzlei.berlin'),
          )
          .filter(([local]) => local.length > 0 && !local.startsWith('.')),
        ([local, domain]) => {
          expect(emailAddress(`${local}@${domain}`).value).toBe(`${local}@${domain.toLowerCase()}`);
        },
      ),
    );
  });
});

describe('postalCode', () => {
  it('accepts five digits', () => {
    expect(postalCode('20354').value).toBe('20354');
  });

  it('refuses short, long, non-digit and unassigned ranges', () => {
    for (const raw of ['', '1234', '123456', 'ABCDE', '00000', '00123', '12 34']) {
      expect(() => postalCode(raw), raw).toThrow(RangeError);
    }
  });

  it('property: any 5-digit code outside 00xxx parses', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 99999 }), (n) => {
        const code = String(n).padStart(5, '0');
        if (code.startsWith('00')) return;
        expect(postalCode(code).value).toBe(code);
      }),
    );
  });
});

describe('personName', () => {
  it('keeps umlauts and ß, collapses whitespace', () => {
    expect(personName('  Jürgen   Müller-Schmidt  ').value).toBe('Jürgen Müller-Schmidt');
    expect(personName("O'Brien").value).toBe("O'Brien");
  });

  it('normalises combining diaeresis to NFC', () => {
    expect(personName('Jürgen').equals(personName('Jürgen'))).toBe(true);
  });

  it('refuses digits, symbols and empties', () => {
    for (const raw of ['', '  ', 'Max123', 'Name!', '@handle']) {
      expect(() => personName(raw), raw).toThrow(RangeError);
    }
  });

  it('property: NFC + collapse is idempotent', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[\p{L} .'-]{1,40}$/u), (raw) => {
        try {
          const once = personName(raw).value;
          expect(personName(once).value).toBe(once);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
        }
      }),
    );
  });
});

describe('money', () => {
  it('adds cents without float error', () => {
    expect(money(10).add(money(20)).cents).toBe(30);
    expect(moneyFromEuros(19.99).cents).toBe(1999);
  });

  it('formats German EUR', () => {
    expect(money(1999).formatDe()).toContain('19,99');
  });

  it('refuses fractions and overflow', () => {
    expect(() => money(1.5)).toThrow(RangeError);
    expect(() => money(1_000_000_001)).toThrow(RangeError);
    expect(() => money(1_000_000_000).add(money(1))).toThrow(RangeError);
  });

  it('property: add is associative and commutative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (a, b, c) => {
          expect(money(a).add(money(b)).add(money(c)).cents).toBe(money(a).add(money(b + c)).cents);
          expect(money(a).add(money(b)).cents).toBe(money(b).add(money(a)).cents);
        },
      ),
    );
  });
});
