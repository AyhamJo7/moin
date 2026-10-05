/**
 * Where to send a person after sign-in (P06.06.01: "redirect only to an approved internal
 * destination").
 *
 * The value arrives from the browser at sign-in start, is stored server-side with the pending
 * sign-in, and is used only after the callback succeeds; it never reaches the identity provider,
 * whose redirect URI is fixed configuration. Because it is caller-controlled, it is accepted only
 * if it is unambiguously a path on this application:
 *
 *   - starts with exactly one `/`, so it cannot be absolute (`https:`), scheme-relative (`//`) or a
 *     pseudo-scheme (`javascript:`);
 *   - contains no backslash, control character or whitespace, raw or percent-encoded, which some
 *     browsers normalise into `/` and so into `//host`;
 *   - contains no `://` and no `//` anywhere once decoded, so a nested `?next=https://…` or
 *     `?next=//evil` cannot be handed on to a page that trusts it;
 *   - does not point back into the sign-in routes themselves, before or after normalisation;
 *   - resolves to the same origin when parsed as a URL, as a final check that no parser quirk
 *     reads it differently.
 *
 * Anything else is refused rather than repaired: a "cleaned" redirect is a redirect someone has
 * found a way to clean into something else.
 */

const MAX_RETURN_PATH_LENGTH = 512;

/** Visible ASCII except backslash. Percent-encoded forms are checked after decoding. */
const SAFE_CHARACTERS = /^[\x21-\x5b\x5d-\x7e]+$/;

const LAST_CONTROL_OR_SPACE = 0x20;
const DELETE = 0x7f;

/** What a decoded form must not contain: controls, whitespace, DEL, backslash. Letters are fine. */
function hasUnsafeCharacter(form: string): boolean {
  for (const character of form) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= LAST_CONTROL_OR_SPACE || code === DELETE || character === '\\') return true;
  }
  return false;
}

const PROBE_ORIGIN = 'https://return-path.invalid';
const AUTH_ROUTES = '/api/auth/';

export function safeReturnPath(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) return undefined;
  if (!SAFE_CHARACTERS.test(raw)) return undefined;
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  // A second decode catches a double-encoded `%252f%252f`, which a downstream page might decode once
  // more. Anything that still decodes differently after two passes is not a plain path.
  let twice: string;
  try {
    twice = decodeURIComponent(decoded);
  } catch {
    return undefined;
  }
  for (const form of [decoded, twice]) {
    if (hasUnsafeCharacter(form)) return undefined;
    if (form.includes('//') || form.toLowerCase().includes(':/')) return undefined;
    if (form.toLowerCase().startsWith(AUTH_ROUTES)) return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, PROBE_ORIGIN);
  } catch {
    return undefined;
  }
  if (parsed.origin !== PROBE_ORIGIN) return undefined;
  // The value returned is the parser's normalised form, so the checks that matter for it are
  // repeated on that form: dot segments (`/api/./auth`, `/x/../api/auth`) normalise into the
  // sign-in routes, and percent-encoding can triple a path's length.
  const normalised = `${parsed.pathname}${parsed.search}`;
  if (normalised.length > MAX_RETURN_PATH_LENGTH) return undefined;
  if (parsed.pathname.toLowerCase().startsWith(AUTH_ROUTES)) return undefined;
  return normalised;
}
