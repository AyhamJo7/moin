/**
 * Outbound webhooks (P29.01 [G:TEN]): tenant subscriptions + signed event
 * delivery (HMAC-SHA256 with timestamp, Standard Webhooks headers) + retry
 * with backoff for 24 h. SSRF-safe delivery, event allowlist, and the live
 * dispatcher ride separately; this module is the sign/subscribe shapes.
 * Secrets stay in Secrets Manager (INV-15); tests use fixtures, never live
 * endpoints.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Versioned public events (P29.02.01 catalogue, subset). */
export const WEBHOOK_EVENTS: readonly string[] = [
  'lead.created',
  'task.created',
  'task.updated',
  'task.completed',
  'contact.created',
];

/** True when the event is in the allowlist. */
export function eventAllowed(event: string): boolean {
  return WEBHOOK_EVENTS.includes(event);
}

export interface Subscription {
  readonly endpoint: string;
  readonly event: string;
}

/** Subscribe: HTTPS endpoint + allowlisted event. */
export function subscribe(endpoint: string, event: string): Subscription | null {
  if (!endpoint.startsWith('https://') || endpoint.length > 500) return null;
  if (!eventAllowed(event)) return null;
  return { endpoint, event };
}

/** Sign a delivery: HMAC-SHA256 over id.timestamp.body (Standard Webhooks). */
export function signDelivery(secret: string, id: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

/** Verify a delivery signature (constant-time). */
export function signatureValid(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const expected = signDelivery(secret, id, timestamp, body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Retry backoff in ms: 1 min × 2^attempt, capped at 24 h window. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** attempt, 86_400_000);
}
