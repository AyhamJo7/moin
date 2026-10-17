/**
 * Hardened response headers (P13.13.01): per-request nonce bound into the
 * CSP, full header set on every owner-app route. Static baseline headers
 * stay in `next.config.ts`; this middleware overrides with the hardened set.
 */
import { NextResponse } from 'next/server';
import { securityHeaders } from './lib/security.ts';

export function middleware(): NextResponse {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = { matcher: '/:path*' };
