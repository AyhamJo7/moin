/**
 * CSRF defence for cookie-authenticated state-changing requests (P06.06.06).
 *
 * Two layers, either of which stops a cross-site forged request on its own:
 *
 * 1. **Origin check.** A request that names an `Origin` must name this deployment's own
 *    origin. Same-origin browser navigations and `fetch` send it; a forged cross-site form
 *    POST sends the attacker's origin (or none it can choose). Checked first because it needs
 *    no per-session state.
 * 2. **Synchronizer token, bound to the session.** The session cookie alone must never
 *    authorise a mutation: cookies ride along on forged requests. Mutations additionally require
 *    a header whose value is derived from the session itself (`deriveCsrfToken`: an HMAC keyed
 *    with the session token, which only the browser and this server hold). It is issued at
 *    sign-in, echoed by same-origin script, and checked against the presented session, so a
 *    token minted for one session is refused on every other (G07 M1). The derivation needs no
 *    server secret of its own and no stored state: the key is the session secret. The
 *    double-submit cookie stays as a second, independent check. Compared in constant time.
 *
 * The expected origin is configuration (`APP_ORIGIN`), never a request header: a host taken
 * from the request is a host the attacker chooses (the same reason `VOICE_PUBLIC_ORIGIN` is
 * configured). Absent configuration fails closed — the loader requires it for the api role.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

/** The label that separates this derivation from any other use of the session token. */
const CSRF_DERIVATION_LABEL = 'moin-csrf-v1';

/**
 * The synchronizer token of a session: base64url(HMAC-SHA256(key = the session token, message =
 * a fixed label)), 43 characters like every token here. Deterministic, so the server recomputes
 * it from the presented session cookie instead of storing it; keyed with the session secret, so
 * it cannot be computed without that secret and reveals nothing about it (an HMAC output is a
 * PRF value, not a key fragment). A different session derives a different token.
 */
export function deriveCsrfToken(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update(CSRF_DERIVATION_LABEL).digest('base64url');
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
 * The header must equal the token derived from the presented session AND the double-submit
 * cookie. A forged cross-site request carries the victim's cookies but its author cannot read
 * the token to echo it into the header, and a token minted for another session is not derived
 * from this one.
 *
 * An absent `Origin` is judged by `Sec-Fetch-Site` and `Referer` when present (see
 * `originlessRequestIsSameSite`); a present but mismatched origin fails closed even with a
 * valid token.
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
  /** The presented session token the header must be derived from (G07 M1). */
  sessionToken: string | undefined;
  /** `Sec-Fetch-Site` and `Referer`, consulted only when `Origin` is absent (G07 L1). */
  fetchSite?: string | string[] | undefined;
  referer?: string | string[] | undefined;
  expectedOrigin: string;
}): CsrfVerdict {
  if (!requiresCsrfProtection(options.method)) return { ok: true };
  const parsed = parseOrigin(options.origin);
  if (options.origin !== undefined && parsed !== options.expectedOrigin) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  if (options.origin === undefined && !originlessRequestIsSameSite(options)) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  if (
    options.sessionToken === undefined ||
    !csrfTokenValid(options.token, deriveCsrfToken(options.sessionToken))
  ) {
    return { ok: false, reason: 'token-invalid' };
  }
  if (options.cookie === undefined || !csrfTokenValid(options.token, options.cookie)) {
    return { ok: false, reason: 'token-invalid' };
  }
  return { ok: true };
}

/**
 * A request without `Origin` (non-browser clients, privacy-stripped requests) is admitted only if
 * nothing else it carries says it is cross-site: a `Sec-Fetch-Site` other than same-origin or
 * none, or a `Referer` naming another origin, refuses it. Absent both, the session-bound token
 * still has to be right (G07 L1, strict Origin verification).
 */
function originlessRequestIsSameSite(options: {
  fetchSite?: string | string[] | undefined;
  referer?: string | string[] | undefined;
  expectedOrigin: string;
}): boolean {
  const site = singleHeader(options.fetchSite);
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const referer = singleHeader(options.referer);
  if (referer !== undefined && parseOrigin(referer) !== options.expectedOrigin) return false;
  return true;
}
