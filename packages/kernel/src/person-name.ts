/**
 * Person names (P07.01.02).
 *
 * Unicode letters, spaces, hyphens and apostrophes — umlauts and ß included, CJK and Arabic too.
 * NFC-normalised so `ü` as one codepoint and `u` + combining diaeresis compare equal. Digits and
 * symbols are refused: a name field is not a note field. Length-capped at 200 characters.
 */

const MAX_LENGTH = 200;
const SHAPE = /^[\p{L}][\p{L} .'-]*$/u;

export interface PersonName {
  /** NFC-normalised, trimmed, inner whitespace collapsed. */
  readonly value: string;
  equals(other: PersonName): boolean;
}

export function personName(raw: string): PersonName {
  const value = raw.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (value.length === 0 || value.length > MAX_LENGTH || !SHAPE.test(value)) {
    throw new RangeError('not a person name');
  }
  return {
    value,
    equals(other: PersonName): boolean {
      return this.value === other.value;
    },
  };
}
