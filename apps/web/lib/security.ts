/**
 * Web security helpers (P13.13.01/.02): hardened header set and CSRF
 * synchronizer check for owner-app mutations. Pure; the Next config and the
 * cookie/token plumbing ride on these shapes.
 */

/** Hardened response headers for every owner-app route. */
export function securityHeaders(nonce: string): Readonly<Record<string, string>> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  };
}

/** Header names the header assertion test requires on every route. */
export function requiredHeaderNames(): readonly string[] {
  return [
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Strict-Transport-Security',
    'Content-Security-Policy',
  ];
}

/** CSRF synchronizer check: mutation carries the cookie token back. */
export function csrfValid(cookieToken: string | null, headerToken: string | null): boolean {
  if (cookieToken === null || cookieToken.length === 0) return false;
  if (headerToken === null) return false;
  return cookieToken === headerToken;
}
