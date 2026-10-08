/**
 * Security-event recording for authentication outcomes (P06.12.02).
 *
 * One row per outcome in `auth_security_events` — a GLOBAL table (no tenant: failed logins
 * happen with no session). Keyed by HMAC-SHA256 digest of IP or subject, never the value
 * (INV-12). Coarse classes only: `callback` not `state_missing_or_malformed` — reason detail
 * is an oracle for failure hunting.
 *
 * Called best-effort from the auth surface: a recording failure must never fail the request
 * it reports on (the request's own verdict stands; the event is observability, not control).
 * Owner notification is PENDING until P14 owns sending (EXT-09 SES): rows land with
 * `owner_notified = false`, honestly unclaimed.
 */

import { createHmac } from 'node:crypto';

export type SecurityOutcome = 'accepted' | 'refused';
export type SecurityClass =
  'sign_in' | 'step_up' | 'throttle' | 'revoke' | 'mfa_change' | 'password_change' | 'new_device';
export type SecurityReason =
  | 'ok'
  | 'callback'
  | 'provider'
  | 'token'
  | 'identity'
  | 'step_up'
  | 'unavailable'
  | 'rate_limited'
  | 'reset';

/** Coarse failure class: detail stays in the log, never in the event row. */
export function reasonClassOf(failure: string): SecurityReason {
  if (failure.startsWith('callback')) return 'callback';
  if (failure.startsWith('provider')) return 'provider';
  if (failure.startsWith('token')) return 'token';
  if (failure.startsWith('identity')) return 'identity';
  if (failure.startsWith('step_up')) return 'step_up';
  return 'unavailable';
}

export function securitySourceDigest(key: string, source: string): Buffer {
  return createHmac('sha256', key).update(source, 'utf8').digest();
}
