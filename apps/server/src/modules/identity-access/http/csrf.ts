/**
 * CSRF defence for cookie-authenticated state-changing requests (P06.06.06).
 *
 * Two layers, either of which stops a cross-site forged request on its own:
 *
 * 1. **Origin check.** A request that names an `Origin` must name this deployment's own
 *    origin. Same-origin browser navigations and `fetch` send it; a forged cross-site form
 *    POST sends the attacker's origin (or none it can choose). Checked first because it needs
 *    no per-session state.
 * 2. **Synchronizer token.** The session cookie alone must never authorise a mutation: cookies
 *    ride along on forged requests. Mutations additionally require a header whose value is a
 *    256-bit secret issued at sign-in and readable only by same-origin script (it is never a
 *    cookie, so the browser never attaches it by itself). Compared in constant time.
 *
 * The expected origin is configuration (`APP_ORIGIN`), never a request header: a host taken
 * from the request is a host the attacker chooses (the same reason `VOICE_PUBLIC_ORIGIN` is
 * configured). Absent configuration fails closed — the loader requires it for the api role.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** The header carrying the synchronizer token. `X-` prefixed, never a cookie. */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Whether the request needs CSRF protection. GET and HEAD are safe and idempotent; everything
 * else mutates or may. Mirrors the session guard's read/mutate split — one definition would be
 * nicer, but the guard maps methods to cache modes and this maps them to protection, and
 * conflating the two would let a future cache change silently move the security boundary.
 */
export function requiresCsrfProtection(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** The first value of a possibly-repeated header. Repeated CSRF headers are rejected downstream. */
export function firstHeader(value: string | string[] | undefined): string | undefined {
  return singleHeader(value);
}

/**
 * Parses a request `Origin` into `scheme://host[:port]`, or undefined when it is not a
 * trustworthy serialised origin. `null` (sandboxed/opaque origin) and non-http(s) schemes
 * are refused: neither can be the application's own origin.
 */
export function parseOrigin(value: string | string[] | undefined): string | undefined {
  const raw = singleHeader(value);
  if (raw === undefined || raw === 'null') return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return undefined;
  }
  return url.origin;
}

/** SHA-256 over the presented value, for the constant-time comparison below. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Whether `presented` is the token issued for this session. Shape-checked first (a wrong shape
 * is refused without touching the expected value), then constant-time — the comparison must not
 * leak the token byte by byte.
 */
export function csrfTokenValid(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !/^[A-Za-z0-9_-]{43}$/.test(presented)) return false;
  const a = digest(presented);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The CSRF verdict for a state-changing request. Returns `ok: true` only when the origin
 * matches (or is absent -- see below) AND the synchronizer token matches the cookie.
 *
 * Double-submit: the expected value is the cookie the browser already sent, not server state --
 * there is nothing to store, rotate or look up. A forged cross-site request carries the
 * victim's cookies but its author cannot read them, so cannot echo the token into the header.
 *
 * An absent `Origin` passes the origin layer: same-origin navigations upgraded to POST,
 * non-browser clients and privacy-stripped requests carry none, and the token layer still
 * stops a forged cross-site request (the attacker cannot read the token). A present but
 * mismatched origin fails closed even with a valid token.
 */
export type CsrfVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'origin-mismatch' | 'token-invalid' };

export function verifyCsrf(options: {
  method: string;
  origin: string | string[] | undefined;
  /** The synchronizer token from the header: script-readable, never attached by itself. */
  token: string | undefined;
  /** The synchronizer token from the cookie: attached by the browser, unreadable cross-site. */
  cookie: string | undefined;
  expectedOrigin: string;
}): CsrfVerdict {
  if (!requiresCsrfProtection(options.method)) return { ok: true };
  const parsed = parseOrigin(options.origin);
  if (options.origin !== undefined && parsed !== options.expectedOrigin) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  if (options.cookie === undefined || !csrfTokenValid(options.token, options.cookie)) {
    return { ok: false, reason: 'token-invalid' };
  }
  return { ok: true };
}
