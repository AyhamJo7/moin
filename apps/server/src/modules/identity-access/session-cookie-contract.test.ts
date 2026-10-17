/**
 * The owner app forwards the session cookie by the name the shared contract gives it (M1). The
 * API's session policy defines the cookie; a rename on either side must fail here, not as a
 * silently signed-out owner app.
 */
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from '@moin/contracts';
import { CSRF_COOKIE, SESSION_COOKIE } from './domain/session-policy.ts';
import { CSRF_HEADER } from './http/csrf.ts';

describe('session cookie contract', () => {
  it('names the cookie the session policy sets', () => {
    expect(SESSION_COOKIE_NAME).toBe(SESSION_COOKIE);
  });

  it('names the CSRF cookie and header the owner app echoes on every mutation (M2A)', () => {
    expect(CSRF_COOKIE_NAME).toBe(CSRF_COOKIE);
    expect(CSRF_HEADER_NAME).toBe(CSRF_HEADER);
  });
});
