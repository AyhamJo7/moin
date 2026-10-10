/**
 * Email addresses (P07.01.02).
 *
 * The domain lower-cases (DNS is case-insensitive); the local part is preserved byte-for-byte —
 * no provider-specific dot-stripping or plus-folding, which would merge two different mailboxes.
 * Identity resolution (P07.03) matches on the normalised whole only when the address is verified.
 */

const MAX_LENGTH = 254;
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailAddress {
  /** `local@domain`, domain lower-cased, local part untouched. */
  readonly value: string;
  readonly local: string;
  readonly domain: string;
  equals(other: EmailAddress): boolean;
}

export function emailAddress(raw: string): EmailAddress {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH || !SHAPE.test(trimmed)) {
    throw new RangeError('not an email address');
  }
  const at = trimmed.lastIndexOf('@');
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (local.length === 0 || domain.length < 3) throw new RangeError('not an email address');
  const value = `${local}@${domain}`;
  return {
    value,
    local,
    domain,
    equals(other: EmailAddress): boolean {
      return this.value === other.value;
    },
  };
}
