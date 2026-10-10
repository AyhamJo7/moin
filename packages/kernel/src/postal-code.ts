/**
 * German postal codes (P07.01.02).
 *
 * Five digits. Only `00000` and the `00xxx` range are refused (`01067` Dresden is a valid code —
 * the `01xxx` range is assigned). Existence of a specific code against the delivery table is a
 * P07.02 lookup concern, not a value-object one — this type answers "shaped like a PLZ", the
 * directory answers "deliverable".
 */

const SHAPE = /^\d{5}$/;

export interface PostalCode {
  readonly value: string;
  equals(other: PostalCode): boolean;
}

export function postalCode(raw: string): PostalCode {
  const value = raw.trim();
  if (!SHAPE.test(value) || value === '00000' || value.startsWith('00')) {
    throw new RangeError('not a German postal code');
  }
  return {
    value,
    equals(other: PostalCode): boolean {
      return this.value === other.value;
    },
  };
}
