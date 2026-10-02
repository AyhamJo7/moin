/**
 * The two cookies this module sets, serialised by hand so the contract is exactly what is written
 * here (P06.06.02, Security Architecture):
 *
 *   `__Host-moin_sid=<token>; Max-Age=<s>; Path=/; HttpOnly; Secure; SameSite=Lax`
 *
 * `__Host-` obliges the browser to refuse the cookie unless it is Secure, has `Path=/` and carries
 * no `Domain`, so no sibling host can plant or overwrite it; there is deliberately no option here
 * to add a Domain or drop Secure. `HttpOnly` keeps it from script; `SameSite=Lax` keeps it off
 * cross-site subrequests while still arriving on the top-level redirect back from the provider.
 *
 * The value can only be one of our 256-bit tokens: `serializeCookie` refuses anything else, so a
 * JWT, an email, a subject or a role cannot be put in a cookie through this module even by mistake.
 *
 * Local development over `http://localhost` still works: browsers treat localhost as a secure
 * context and accept Secure cookies there. Nothing is weakened for it.
 */

import { type SESSION_COOKIE, type SIGN_IN_COOKIE } from '../domain/session-policy.ts';
import { isSecretValue } from '../domain/secret-values.ts';

export type CookieName = typeof SESSION_COOKIE | typeof SIGN_IN_COOKIE;

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export function serializeCookie(name: CookieName, value: string, maxAgeSeconds: number): string {
  if (!isSecretValue(value)) {
    throw new TypeError('a cookie carries only an opaque 256-bit token');
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError('cookie lifetime must be a positive whole number of seconds');
  }
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; ${ATTRIBUTES}`;
}

export function clearCookie(name: CookieName): string {
  return `${name}=; Max-Age=0; ${ATTRIBUTES}`;
}

/**
 * The value of `name` in a `Cookie` header, or undefined. A name that appears more than once is
 * treated as absent: two values for one `__Host-` cookie means something is wrong, and choosing
 * either would let whoever set the other one decide.
 */
export function readCookie(header: string | undefined, name: CookieName): string | undefined {
  if (header === undefined) return undefined;
  const values = header
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  if (values.length !== 1) return undefined;
  const [value] = values;
  return isSecretValue(value) ? value : undefined;
}
