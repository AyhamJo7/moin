/**
 * Phone numbers (P07.01.01).
 *
 * Canonical form is E.164 (`+49…`), parsed with libphonenumber and a DE default region, so a
 * national `030 …` input and its `+49 30 …` spelling land on the same value. Identity resolution
 * (P07.03) matches on this string and nothing else.
 *
 * Two deliberate carve-outs. Reserved and test ranges (RFC 5737 documentation space, 555 fiction
 * numbers, premium/entertainment prefixes) are refused: a test fixture must never become a tenant's
 * callback number. Type detection answers only the question the product asks — mobile vs landline
 * for callback routing — and returns `unknown` where libphonenumber cannot tell.
 */

import {
  isValidPhoneNumber,
  parsePhoneNumberWithError,
  type PhoneNumber as ParsedPhoneNumber,
} from 'libphonenumber-js/max';

const DEFAULT_REGION = 'DE';

/** Documentation, fiction and premium ranges that must never become a callback number. */
const RESERVED_PREFIXES = ['+49800', '+49900', '+49555', '+49115', '+49116', '+49699'];

export type PhoneKind = 'mobile' | 'landline' | 'unknown';

export interface PhoneNumber {
  readonly e164: string;
  readonly kind: PhoneKind;
  /** National spelling for display (`030 123456`), never for matching. */
  national(): string;
  equals(other: PhoneNumber): boolean;
}

function kindOf(parsed: ParsedPhoneNumber): PhoneKind {
  const type = parsed.getType();
  if (type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE') return 'mobile';
  if (type === 'FIXED_LINE') return 'landline';
  return 'unknown';
}

function parse(raw: string): ParsedPhoneNumber {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new RangeError('phone number is empty');
  let parsed: ParsedPhoneNumber;
  try {
    parsed = parsePhoneNumberWithError(trimmed, DEFAULT_REGION);
  } catch {
    throw new RangeError(`not a parseable phone number: ${trimmed.slice(0, 32)}`);
  }
  if (!parsed.isValid()) throw new RangeError(`not a valid phone number: ${trimmed.slice(0, 32)}`);
  const e164 = parsed.number;
  if (!isValidPhoneNumber(e164) || RESERVED_PREFIXES.some((prefix) => e164.startsWith(prefix))) {
    throw new RangeError('reserved or test range: not a callable number');
  }
  return parsed;
}

export function phoneNumber(raw: string): PhoneNumber {
  const parsed = parse(raw);
  const e164 = parsed.number;
  const kind = kindOf(parsed);
  return {
    e164,
    kind,
    national(): string {
      return parsed.formatNational();
    },
    equals(other: PhoneNumber): boolean {
      return this.e164 === other.e164;
    },
  };
}
