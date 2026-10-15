/**
 * Provider inbox + deduplication (P08.03, ADR-0007, FS-01).
 *
 * Insert-then-ack (P08.03.01): the worker inserts (provider, provider_event_id)
 * FIRST — a redelivery 409s on the UNIQUE and is acknowledged without effect.
 * Only the insert winner resolves the tenant and runs the handler inside
 * `withTenant` (P08.03.02). Poison (schema-invalid) events go to DLQ state
 * immediately with a reason (P08.03.02); payloads purge after 30 days
 * (P08.03.03 — the received_at column is the retention hook, P16 owns the job).
 *
 * Out-of-order events (P08.03.04) are the handler's job: handlers compare a
 * monotonic marker (aggregate_ver, provider sequence) and ignore backwards
 * moves — the inbox preserves arrival order per event, it does not sequence.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

export type InboxStatus = 'received' | 'resolved' | 'poisoned';

/** Duplicate delivery: acknowledged, no effect (FS-01). */
export class DuplicateEventError extends Error {
  public override readonly name = 'DuplicateEventError';
}

export interface InboxEvent {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly status: InboxStatus;
}

function checkLabel(value: string, what: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new RangeError(`${what} must be 1..${String(max)} characters`);
  }
  return trimmed;
}

/**
 * Receive one provider event: insert-then-ack. Returns the row on first
 * delivery; throws DuplicateEventError on redelivery (caller acks, no effect).
 */
export async function receiveProviderEvent(
  pool: Pool,
  input: {
    provider: string;
    providerEventId: string;
    payload?: Readonly<Record<string, string>> | undefined;
  },
): Promise<InboxEvent> {
  const provider = checkLabel(input.provider, 'provider', 40);
  const eventId = checkLabel(input.providerEventId, 'provider event id', 160);
  const id = randomUUID();
  try {
    const done = await pool.query<{
      id: string;
      provider: string;
      provider_event_id: string;
      status: string;
    }>(
      `insert into provider_inbox (id, provider, provider_event_id, payload)
       values ($1::uuid, $2::text, $3::text, $4::jsonb)
       returning id::text, provider, provider_event_id, status`,
      [id, provider, eventId, JSON.stringify(input.payload ?? {})],
    );
    const row = done.rows[0];
    if (row === undefined) throw new Error('inbox insert returned no row');
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      status: row.status as InboxStatus,
    };
  } catch (error) {
    if (error instanceof Error && /duplicate|unique/i.test(error.message)) {
      throw new DuplicateEventError('provider event already received');
    }
    throw error;
  }
}

/**
 * Process one inbox row: resolve the tenant via `resolve`, run `handle`
 * inside `withTenant`, mark resolved. Poison (resolve/handle rejects with
 * RangeError = schema-invalid) marks poisoned with the reason — DLQ state,
 * never a retry loop. Other errors propagate: the row stays received.
 */
export async function processInboxEvent(
  pool: Pool,
  inboxId: string,
  resolve: (eventId: string) => Promise<string>,
  handle: (organisationId: string, eventId: string) => Promise<void>,
): Promise<InboxStatus> {
  const found = await pool.query<{ id: string; status: string }>(
    `select id::text, status from provider_inbox where id = $1::uuid`,
    [inboxId],
  );
  const row = found.rows[0];
  if (row === undefined) throw new RangeError('unknown inbox event');
  if (row.status !== 'received') return row.status as InboxStatus;
  let organisationId: string;
  try {
    organisationId = await resolve(row.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'unresolvable';
    await pool.query(
      `update provider_inbox set status = 'poisoned', poison_reason = $2::text,
         resolved_at = now() where id = $1::uuid`,
      [row.id, reason],
    );
    return 'poisoned';
  }
  try {
    // The handler receives ids; it opens its own client inside withTenant.
    // The tenant scope here is what confines it — no client escapes.
    await withTenant(pool, organisationId, () => handle(organisationId, row.id));
  } catch (error) {
    if (error instanceof RangeError) {
      const reason = error.message.slice(0, 200);
      await pool.query(
        `update provider_inbox set status = 'poisoned', poison_reason = $2::text,
           resolved_at = now() where id = $1::uuid`,
        [row.id, reason],
      );
      return 'poisoned';
    }
    throw error;
  }
  await pool.query(
    `update provider_inbox set status = 'resolved', resolved_org = $2::uuid,
       resolved_at = now() where id = $1::uuid`,
    [row.id, organisationId],
  );
  return 'resolved';
}
