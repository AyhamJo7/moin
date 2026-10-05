/**
 * The random values sign-in and sessions are built from (P06.06.01/.02).
 *
 * Every one is 256 bits from the platform CSPRNG, encoded base64url without padding: 43
 * characters, which is also inside the 43–128 range RFC 7636 requires of a PKCE verifier. What the
 * database keeps is the SHA-256 of the encoded string, never the value: a digest lets the server
 * recognise a token it is shown without being able to produce one.
 *
 * The digest is taken over the exact string, not over its decoded bytes. base64url decoding
 * ignores trailing bits, so two different 43-character strings can decode to the same 32 bytes;
 * hashing the string keeps "the value the browser presented" and "the value we issued" one thing.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits (P06.06.02: "SHA-256 hash of a 256-bit random session token"). */
export const SECRET_BYTES = 32;

/** The only shape an issued value can have. Anything else presented to us is refused unread. */
export const SECRET_VALUE = /^[A-Za-z0-9_-]{43}$/;

export function randomSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export function isSecretValue(value: unknown): value is string {
  return typeof value === 'string' && SECRET_VALUE.test(value);
}

export function digestOf(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison of two digests. */
export function digestsEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** RFC 7636 §4.2, `S256`: BASE64URL(SHA256(ASCII(code_verifier))). There is no other method here. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
