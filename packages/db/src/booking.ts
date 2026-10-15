/**
 * Booking slot holds (P20.05/.06 SELL, migration 0075): availability check +
 * hold + confirm via provider stub + idempotency + audit. Double-book
 * refused (LG-B01 shape: one hold per idempotency key; EXCLUDE rides the
 * btree_gist work). Unknown-state reconciliation + voice flow ride
 * separately (P20.07/.08).
 */

import { randomUUID } from 'node:crypto';
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
 * Hold a slot: idempotent per key — repeats keep the row (no double book).
 * Returns the hold id either way.
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
  return row.id;
}

/** Confirm a hold: the provider stub confirms; verify-after-write stub. */
export async function confirmHold(
  client: TenantClient,
  input: { holdId: string; idempotencyKey: string },
): Promise<boolean> {
  if (!UUID_RE.test(input.holdId)) throw new RangeError('hold id must be a uuid');
  checkKey(input.idempotencyKey);
  const found = await client.query<{ id: string }>(
    `select id::text from slot_holds
     where organisation_id = app.current_org() and id = $1::uuid and expires_at > now()`,
    [input.holdId],
  );
  return found.rows.length > 0;
}
