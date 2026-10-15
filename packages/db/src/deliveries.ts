/**
 * Delivery tracking, retries and dedup (P14.07.01/.03, migration 0073).
 *
 * `recordDelivery` writes one receipt per attempt; redeliveries reuse the
 * idempotency key — repeats keep the row (no duplicate delivery).
 * `retryDelayMs` bounds retries with backoff: attempts past MAX_ATTEMPTS go
 * to the DLQ. `nextAttempt` is the pure transition: failed under the bound
 * retries, failed at the bound goes DLQ, sent stays sent.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type DeliveryChannel = 'inapp' | 'email' | 'sms';
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'dlq';

/** Bounded retries: attempts past this go to the DLQ. */
export const MAX_ATTEMPTS = 3;

/** Backoff base: 30 s × 2^attempt. */
export const RETRY_BASE_MS = 30_000;

/** Backoff delay for the next attempt. */
export function retryDelayMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** attempt;
}

/** Pure transition: failed under the bound retries, at the bound goes DLQ. */
export function nextAttempt(status: DeliveryStatus, attempt: number): DeliveryStatus {
  if (status === 'sent') return 'sent';
  if (status === 'dlq') return 'dlq';
  if (status === 'pending') return 'pending';
  return attempt >= MAX_ATTEMPTS ? 'dlq' : 'pending';
}

/** Record one delivery receipt: idempotent per idempotency key. */
export async function recordDelivery(
  client: TenantClient,
  input: {
    notificationId: string;
    channel: DeliveryChannel;
    attempt: number;
    status: DeliveryStatus;
    providerId?: string | undefined;
    idempotencyKey: string;
  },
): Promise<string> {
  if (!UUID_RE.test(input.notificationId)) throw new RangeError('notification id must be a uuid');
  if (!Number.isInteger(input.attempt) || input.attempt < 0) {
    throw new RangeError('attempt must be an integer ≥ 0');
  }
  const key = input.idempotencyKey.trim();
  if (key.length === 0 || key.length > 160) {
    throw new RangeError('idempotency key must be 1..160 characters');
  }
  if (
    input.providerId !== undefined &&
    (input.providerId.trim().length === 0 || input.providerId.length > 160)
  ) {
    throw new RangeError('provider id must be 1..160 characters');
  }
  const done = await client.query<{ id: string }>(
    `insert into notification_deliveries (organisation_id, id, notification_id, channel, attempt, status, provider_id, idempotency_key)
     values (app.current_org(), $1::uuid, $2::uuid, $3::text, $4::integer, $5::text, $6::text, $7::text)
     on conflict (organisation_id, idempotency_key) do nothing
     returning id::text`,
    [
      randomUUID(),
      input.notificationId,
      input.channel,
      input.attempt,
      input.status,
      input.providerId ?? null,
      key,
    ],
  );
  const row = done.rows[0];
  if (row === undefined) {
    const existing = await client.query<{ id: string }>(
      `select id::text from notification_deliveries
       where organisation_id = app.current_org() and idempotency_key = $1::text`,
      [key],
    );
    const found = existing.rows[0];
    if (found === undefined) throw new Error('delivery record returned no row');
    return found.id;
  }
  return row.id;
}
