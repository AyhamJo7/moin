import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import {
  SECRET_BYTES,
  digestOf,
  digestsEqual,
  isSecretValue,
  pkceChallenge,
  randomSecret,
} from './secret-values.ts';

describe('the random values sign-in is built from', () => {
  evidenceTest('carry 256 bits from the CSPRNG and never repeat', () => {
    expect(SECRET_BYTES * 8).toBe(256);
    const values = Array.from({ length: 1000 }, () => randomSecret());
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('recognise only the shape we issue', () => {
    expect(isSecretValue(randomSecret())).toBe(true);
    for (const value of [undefined, '', 'x', `${randomSecret()}=`, `${randomSecret()}a`, 42]) {
      expect(isSecretValue(value)).toBe(false);
    }
    expect(isSecretValue('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl')).toBe(false);
  });

  it('digest to 32 bytes and compare in constant time', () => {
    const value = randomSecret();
    expect(digestOf(value)).toHaveLength(32);
    expect(digestsEqual(digestOf(value), digestOf(value))).toBe(true);
    expect(digestsEqual(digestOf(value), digestOf(randomSecret()))).toBe(false);
    expect(digestsEqual(digestOf(value), Buffer.alloc(31))).toBe(false);
  });

  it('derive the PKCE S256 challenge as BASE64URL(SHA-256(verifier))', () => {
    // Computed independently of this code (Python hashlib + urlsafe_b64encode, padding stripped).
    expect(pkceChallenge('dBjftJeZ4CVP-mJ92K9qp6Bmp6BY5Pf8xOJ-yRqF3yM')).toBe(
      'v6d9NmlV9orFIOrkY80_GArmSepIII_eUU_kibgdn5A',
    );
  });
});
