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

  it('accepts callable neighbours of refused ranges', () => {
    // 0800 freephone is callable; only the 069 90009 000–999 drama block is refused, not 069.
    expect(phoneNumber('+49 800 1234567').e164).toBe('+498001234567');
    expect(phoneNumber('+49 69 123456').e164).toBe('+4969123456');
  });

  it('refuses garbage, empties and reserved ranges', () => {
    for (const raw of [
      '',
      'abc',
      '123',
      '+49 555 1234',
      '+1 555 0100',
      '+49 69 90009001',
      '+49 115',
    ]) {
      expect(() => phoneNumber(raw), raw).toThrow(RangeError);
    }
  });

  it('never echoes the input in an error (INV-12)', () => {
    const secret = '+49 30 12345678901234567890';
    try {
      phoneNumber(secret);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).not.toContain('1234567890');
    }
  });

  it('property: generated DE numbers round-trip through E.164', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            // Area codes and mobile prefixes that libphonenumber accepts as valid.
            fc.constantFrom('030', '040', '089', '069', '0201', '030', '0151', '0170', '0160'),
            fc.integer({ min: 100000, max: 99999999 }),
          )
          .map(
            ([prefix, subscriber]) =>
              `+49 ${prefix.slice(prefix.startsWith('0') ? 1 : 0)} ${subscriber}`,
          )
          .filter((candidate) => {
            try {
              phoneNumber(candidate);
              return true;
            } catch {
              return false;
            }
          }),
        (e164input) => {
          const once = phoneNumber(e164input);
          expect(phoneNumber(once.e164).e164).toBe(once.e164);
          expect(phoneNumber(once.national()).e164).toBe(once.e164);
        },
      ),
    );
  });

  it('property: reserved ranges are always refused', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom('+49555', '+49115', '+49116')
          .chain((prefix) => fc.integer({ min: 100000, max: 9999999 }).map((n) => `${prefix}${n}`)),
        (reserved) => {
          expect(() => phoneNumber(reserved)).toThrow(RangeError);
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
  it('accepts five digits, including the 01xxx range', () => {
    expect(postalCode('20354').value).toBe('20354');
    expect(postalCode('01067').value).toBe('01067');
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

  it('rounds decimal euros, not binary floats', () => {
    // 1.005 * 100 is 100.49999… in binary: Math.round would give 100, the decimal spelling 101.
    expect(moneyFromEuros(1.005).cents).toBe(101);
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
