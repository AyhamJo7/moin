/**
 * Hardened response headers (P13.13.01): per-request nonce bound into the
 * CSP, full header set on every owner-app route. Static baseline headers
 * stay in `next.config.ts`; this middleware overrides with the hardened set.
 *
 * The nonce also travels on the *request* (`content-security-policy`, `x-nonce`): Next reads the
 * policy there to stamp its own inline scripts, which the page's client islands need to hydrate
 * under `script-src 'self' 'nonce-…'`. Without it the scripts are blocked and "Erledigt" is inert.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from './lib/security.ts';

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const headers = securityHeaders(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', headers['Content-Security-Policy'] ?? '');
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = { matcher: '/:path*' };
