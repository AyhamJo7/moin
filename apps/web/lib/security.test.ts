/**
 * Web security helpers (P13.13.03): headers-present + CSRF-reject.
 */
import { describe, expect, it } from 'vitest';
import { csrfValid, requiredHeaderNames, securityHeaders } from './security.ts';

describe('owner-app web security', () => {
  it('emits the hardened header set with nonce-bound CSP', () => {
    const headers = securityHeaders('n-1');
    for (const name of requiredHeaderNames()) expect(headers[name]).toBeDefined();
    expect(headers['Content-Security-Policy']).toContain("'nonce-n-1'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Strict-Transport-Security']).toContain('max-age=');
  });

  it('rejects mutations without a matching CSRF token pair', () => {
    expect(csrfValid('t', 't')).toBe(true);
    expect(csrfValid('t', 'other')).toBe(false);
    expect(csrfValid(null, 't')).toBe(false);
    expect(csrfValid('t', null)).toBe(false);
    expect(csrfValid('', 't')).toBe(false);
  });
});
