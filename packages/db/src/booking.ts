/**
 * Booking slot holds (P20.05/.06 SELL, migrations 0075/0076): availability
 * check + hold + confirm with state + idempotency + audit. Double-book
 * refused at two levels: the app checks active overlapping holds before
 * insert, and the EXCLUDE constraint blocks races at the database level
 * (LG-B01). Unknown-state reconciliation + voice flow ride separately
 * (P20.07/.08).
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Hold TTL: 2 minutes (P20.05.01). */
export const HOLD_TTL_MS = 120_000;

function checkKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > 160) {
    throw new RangeError('idempotency key must be 1..160 characters');
  }
  return trimmed;
}

/**
 * Hold a slot: availability first — an active unexpired overlapping hold on
 * the same resource blocks a second key (genuine two-caller refusal); the
 * EXCLUDE constraint backs it under concurrency. Idempotent per key —
 * repeats return the existing hold. Returns the hold id either way.
 * Refusals throw HoldRefused (no row written) with an audit event.
 */
export async function holdSlot(
  client: TenantClient,
  input: {
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
    idempotencyKey: string;
  },
): Promise<string> {
  if (!UUID_RE.test(input.resourceId)) throw new RangeError('resource id must be a uuid');
  if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime())) {
    throw new RangeError('slot bounds must be dates');
  }
  if (input.endsAt <= input.startsAt) throw new RangeError('slot must end after it starts');
  const key = checkKey(input.idempotencyKey);
  // Same-key retry: return the existing hold without re-checking overlap.
  const retry = await client.query<{ id: string }>(
    `select id::text from slot_holds
     where organisation_id = app.current_org() and idempotency_key = $1::text`,
    [key],
  );
  const prior = retry.rows[0];
  if (prior !== undefined) return prior.id;
  // Availability: any active unexpired overlapping hold on this resource blocks.
  const clash = await client.query<{ id: string }>(
    `select id::text from slot_holds
     where organisation_id = app.current_org() and resource_id = $1::uuid
       and expires_at > now()
       and tstzrange(starts_at, ends_at) && tstzrange($2::timestamptz, $3::timestamptz)
     limit 1`,
    [input.resourceId, input.startsAt.toISOString(), input.endsAt.toISOString()],
  );
  if (clash.rows.length > 0) {
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'booking.hold',
      targetKind: 'slot_hold',
      argsSanitized: { refused: 1 },
      result: 'rejected',
    });
    throw new HoldRefused('slot unavailable: overlapping active hold');
  }
  const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
  const done = await client.query<{ id: string }>(
    `insert into slot_holds (organisation_id, id, resource_id, starts_at, ends_at, idempotency_key, expires_at)
     values (app.current_org(), $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5::text, $6::timestamptz)
     on conflict (organisation_id, idempotency_key) do nothing
     returning id::text`,
    [
      randomUUID(),
      input.resourceId,
      input.startsAt.toISOString(),
      input.endsAt.toISOString(),
      key,
      expiresAt.toISOString(),
    ],
  );
  const row = done.rows[0];
  if (row === undefined) {
    const existing = await client.query<{ id: string }>(
      `select id::text from slot_holds
       where organisation_id = app.current_org() and idempotency_key = $1::text`,
      [key],
    );
    const found = existing.rows[0];
    if (found === undefined) throw new Error('slot hold returned no row');
    return found.id;
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'booking.hold',
    targetKind: 'slot_hold',
    targetId: row.id,
    argsSanitized: { holds: 1 },
    result: 'succeeded',
  });
  return row.id;
}

/** Thrown when availability refuses the hold (no row written). */
export class HoldRefused extends Error {
  public override readonly name = 'HoldRefused';
  public constructor(message: string) {
    super(message);
  }
}

/**
 * Confirm a hold: persists the confirmation marker keyed by the confirm
 * idempotency key (retry-safe: same key returns the prior outcome) and
 * audits the result. Expired or missing holds refuse with an audit event.
 */
export async function confirmHold(
  client: TenantClient,
  input: { holdId: string; idempotencyKey: string },
): Promise<boolean> {
  if (!UUID_RE.test(input.holdId)) throw new RangeError('hold id must be a uuid');
  const key = checkKey(input.idempotencyKey);
  const prior = await client.query<{ status: string }>(
    `select status from booking_confirms
     where organisation_id = app.current_org() and idempotency_key = $1::text`,
    [key],
  );
  const seen = prior.rows[0];
  if (seen !== undefined) return seen.status === 'confirmed';
  const found = await client.query<{ id: string }>(
    `select id::text from slot_holds
     where organisation_id = app.current_org() and id = $1::uuid and expires_at > now()`,
    [input.holdId],
  );
  const ok = found.rows.length > 0;
  await client.query(
    `insert into booking_confirms (organisation_id, id, hold_id, idempotency_key, status)
     values (app.current_org(), $1::uuid, $2::uuid, $3::text, $4::text)
     on conflict (organisation_id, idempotency_key) do nothing`,
    [randomUUID(), input.holdId, key, ok ? 'confirmed' : 'refused'],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'booking.confirm',
    targetKind: 'slot_hold',
    targetId: input.holdId,
    argsSanitized: ok ? { confirmed: 1 } : { refused: 1 },
    result: ok ? 'succeeded' : 'rejected',
  });
  return ok;
}
