/**
 * The owner app forwards the session cookie by the name the shared contract gives it (M1). The
 * API's session policy defines the cookie; a rename on either side must fail here, not as a
 * silently signed-out owner app.
 */
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@moin/contracts';
import { SESSION_COOKIE } from './domain/session-policy.ts';

describe('session cookie contract', () => {
  it('names the cookie the session policy sets', () => {
    expect(SESSION_COOKIE_NAME).toBe(SESSION_COOKIE);
  });
});
