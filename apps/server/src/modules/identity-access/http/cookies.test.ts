import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SIGN_IN_COOKIE } from '../domain/session-policy.ts';
import { randomSecret } from '../domain/secret-values.ts';
import { clearCookie, readCookie, serializeCookie } from './cookies.ts';

describe('the session cookie', () => {
  evidenceTest(
    'is exactly __Host-moin_sid, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain',
    () => {
      const token = randomSecret();
      const header = serializeCookie(SESSION_COOKIE, token, 604_800);
      expect(header).toBe(
        `__Host-moin_sid=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
      const attributes = header.split('; ').slice(1);
      expect(attributes).toContain('HttpOnly');
      expect(attributes).toContain('Secure');
      expect(attributes).toContain('SameSite=Lax');
      expect(attributes).toContain('Path=/');
      expect(attributes.some((attribute) => /^domain=/i.test(attribute))).toBe(false);
    },
  );

  evidenceTest('carries only an opaque token, never a JWT, an email or a claim', () => {
    for (const value of [
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      'inhaber@musterrestaurant.example',
      'org=0192f0a0;role=owner',
      '',
    ]) {
      expect(() => serializeCookie(SESSION_COOKIE, value, 60), value).toThrow(TypeError);
    }
  });

  it('clears with the same attributes, so the browser matches it', () => {
    expect(clearCookie(SIGN_IN_COOKIE)).toBe(
      '__Host-moin_signin=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('is read only when it appears once and has the issued shape', () => {
    const token = randomSecret();
    expect(readCookie(`a=1; ${SESSION_COOKIE}=${token}; b=2`, SESSION_COOKIE)).toBe(token);
    expect(
      readCookie(`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${randomSecret()}`, SESSION_COOKIE),
    ).toBeUndefined();
    expect(readCookie(`${SESSION_COOKIE}=attacker-chosen`, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(`x${SESSION_COOKIE}=${token}`, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });
});
