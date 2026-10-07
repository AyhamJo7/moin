import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { randomSecret } from '../domain/secret-values.ts';
import {
  CSRF_HEADER,
  firstHeader,
  parseOrigin,
  requiresCsrfProtection,
  verifyCsrf,
} from './csrf.ts';

const ORIGIN = 'https://app.example.de';

function valid(token = randomSecret()) {
  return {
    method: 'POST',
    origin: ORIGIN,
    token,
    cookie: token,
    expectedOrigin: ORIGIN,
  };
}

describe('the CSRF verdict (P06.06.06)', () => {
  evidenceTest('GET and HEAD never need proof, every other method does', () => {
    expect(requiresCsrfProtection('GET')).toBe(false);
    expect(requiresCsrfProtection('HEAD')).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(requiresCsrfProtection(method), method).toBe(true);
    }
    expect(verifyCsrf({ ...valid(), method: 'GET', token: undefined, cookie: undefined }).ok).toBe(
      true,
    );
  });

  evidenceTest('a matching origin and token passes', () => {
    expect(verifyCsrf(valid()).ok).toBe(true);
  });

  evidenceTest('a missing token fails, even with a matching origin', () => {
    expect(verifyCsrf({ ...valid(), token: undefined })).toStrictEqual({
      ok: false,
      reason: 'token-invalid',
    });
  });

  evidenceTest('a forged token fails: the header must echo the cookie', () => {
    expect(verifyCsrf({ ...valid(), token: randomSecret() })).toStrictEqual({
      ok: false,
      reason: 'token-invalid',
    });
  });

  evidenceTest('a missing cookie fails closed: old sessions re-login', () => {
    expect(verifyCsrf({ ...valid(), cookie: undefined })).toStrictEqual({
      ok: false,
      reason: 'token-invalid',
    });
  });

  evidenceTest('a mismatched origin fails even with a valid token', () => {
    expect(verifyCsrf({ ...valid(), origin: 'https://evil.example' })).toStrictEqual({
      ok: false,
      reason: 'origin-mismatch',
    });
  });

  evidenceTest('an absent origin passes the origin layer, not the token layer', () => {
    expect(verifyCsrf({ ...valid(), origin: undefined }).ok).toBe(true);
    expect(verifyCsrf({ ...valid(), origin: undefined, token: randomSecret() })).toStrictEqual({
      ok: false,
      reason: 'token-invalid',
    });
  });

  evidenceTest('opaque and non-http origins never match', () => {
    for (const origin of ['null', 'file:///etc/passwd', 'ftp://app.example.de', 'not a url']) {
      expect(verifyCsrf({ ...valid(), origin })).toStrictEqual({
        ok: false,
        reason: 'origin-mismatch',
      });
    }
  });

  evidenceTest('a repeated header takes the first value', () => {
    expect(firstHeader(['a', 'b'])).toBe('a');
    expect(firstHeader(undefined)).toBe(undefined);
    expect(CSRF_HEADER).toBe('x-csrf-token');
  });

  evidenceTest('parseOrigin reduces to scheme, host and port', () => {
    expect(parseOrigin('https://app.example.de/some/path?q=1')).toBe('https://app.example.de');
    expect(parseOrigin('http://localhost:3000/x')).toBe('http://localhost:3000');
    expect(parseOrigin(undefined)).toBeUndefined();
  });
});
