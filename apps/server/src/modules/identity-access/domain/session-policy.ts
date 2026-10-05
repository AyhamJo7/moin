/**
 * Session and sign-in policy (P06.06.02, T-15, ADR-0005).
 *
 * The lifetimes are enforced by the database — migration 0012 fixes them in the functions and
 * again as CHECK ceilings — so these constants are what the application *derives* from that policy
 * (a cookie's lifetime, a test's boundaries), not a second place it could be changed. A change to
 * T-15 changes both, in one reviewed pull request.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A session expires 12 hours after its last activity (T-15). */
export const IDLE_TIMEOUT_MS = 12 * HOUR_MS;

/** …and 7 days after sign-in, whatever the activity and however often it rotates (T-15). */
export const ABSOLUTE_TIMEOUT_MS = 7 * DAY_MS;

/** A pending sign-in is usable for 10 minutes: long enough for MFA, short enough to be stale. */
export const AUTH_TRANSACTION_TTL_MS = 10 * MINUTE_MS;

/**
 * A sensitive action needs MFA proof within the last 15 minutes (P06.06.04, PLAN Security
 * Architecture). Judged against the step-up stamp the database returns — never a caller claim.
 */
export const STEP_UP_WINDOW_MS = 15 * MINUTE_MS;

/**
 * The application session cookie (Security Architecture: `__Host-moin_sid`, HttpOnly, Secure,
 * SameSite=Lax, Path=/). `__Host-` makes the browser refuse it unless it is Secure, has Path=/ and
 * carries no Domain, so no sibling host can plant or overwrite it.
 */
export const SESSION_COOKIE = '__Host-moin_sid';

/**
 * Binds a pending sign-in to the browser that started it, so a callback URL replayed in another
 * browser fails even with a valid `state` (RFC 9700 §4.7, login CSRF). Same attributes as the
 * session cookie; Lax is required because the callback is a top-level redirect from the provider.
 */
export const SIGN_IN_COOKIE = '__Host-moin_signin';

/** Where sign-in lands when no return path was asked for. */
export const DEFAULT_RETURN_PATH = '/';

/** The callback route. `OIDC_REDIRECT_URI` must name exactly this path, or sign-in refuses to start. */
export const CALLBACK_PATH = '/api/auth/callback';

/** The route that starts a sign-in. */
export const LOGIN_PATH = '/api/auth/login';

/** Why a session was replaced by a successor carrying a new token. */
export type RotationReason = 'step_up' | 'privilege_change';
