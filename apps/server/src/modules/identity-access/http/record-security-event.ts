/**
 * Best-effort security event for the authenticated and unauthenticated auth surface (P06.12.02).
 *
 * One shared writer so every controller records the same way: the source is the HMAC digest of
 * the socket address under the throttle key (INV-12: no address, subject or detail is stored),
 * a missing key records nothing, and a failed write never fails the request it reports on.
 */

import type { AuthThrottleStore } from '../../platform/auth-throttle-store.ts';
import {
  reasonClassOf,
  securitySourceDigest,
  type SecurityClass,
  type SecurityReason,
} from '../application/security-events.ts';

export function recordSecurityEvent(
  store: AuthThrottleStore,
  key: string | undefined,
  request: { ip?: string },
  cls: SecurityClass,
  outcome: 'accepted' | 'refused',
  reason: string,
  newFamily = false,
): Promise<void> {
  if (key === undefined) return Promise.resolve();
  const ip = typeof request.ip === 'string' ? request.ip : 'invalid';
  const resolved: SecurityReason =
    reason === 'ok' || reason === 'rate_limited' || reason === 'reset'
      ? reason
      : reasonClassOf(reason);
  return store.recordEvent(
    outcome,
    cls,
    resolved,
    securitySourceDigest(key, `ip:${ip}`),
    newFamily,
  );
}
