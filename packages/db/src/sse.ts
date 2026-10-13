/**
 * SSE event store (P08.08.02, ADR-0009): the 15-minute replay window behind
 * the live Valkey fan-out.
 *
 * `publishEvent` writes one row per (org, user) delivery — the dispatcher
 * calls it, then publishes the same event_id to Valkey. `replaySince`
 * serves Last-Event-ID reconnects: rows after the given event_id for this
 * user, ordered, capped. Cross-tenant isolation is FORCE RLS (migration
 * 0068) — a tenant never replays another's events (P08.08.04).
 *
 * Degraded mode (P08.08.03) is the client's: Valkey down → poll this store
 * every 30 s. No banner needed; the rows are the fallback.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Replay window: 15 minutes (P08.08.02). */
export const SSE_REPLAY_MINUTES = 15;

export interface SseEvent {
  readonly eventId: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, string>>;
}

function checkType(type: string): string {
  const trimmed = type.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError('event type must be 1..80 characters');
  }
  return trimmed;
}

function checkPayload(payload: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (key.length === 0 || key.length > 64) {
      throw new RangeError(`payload key "${key}" must be 1..64 characters`);
    }
    if (typeof value !== 'string' || value.length > 160) {
      throw new RangeError(`payload["${key}"] must be a string ≤ 160 chars`);
    }
  }
}

/** Publish one event to a user's channel; returns the stream event_id. */
export async function publishEvent(
  client: TenantClient,
  input: { userId: string; type: string; payload?: Readonly<Record<string, string>> | undefined },
): Promise<number> {
  if (!UUID_RE.test(input.userId)) throw new RangeError('user id must be a uuid');
  const type = checkType(input.type);
  checkPayload(input.payload ?? {});
  const done = await client.query<{ event_id: string }>(
    `insert into sse_events (organisation_id, id, user_id, event_type, payload)
     values (app.current_org(), $1::uuid, $2::uuid, $3::text, $4::jsonb)
     returning event_id::text`,
    [randomUUID(), input.userId, type, JSON.stringify(input.payload ?? {})],
  );
  const row = done.rows[0];
  if (row === undefined) throw new Error('sse publish returned no row');
  return Number(row.event_id);
}

/** Replay rows after lastEventId for this user, within the 15-min window. */
export async function replaySince(
  client: TenantClient,
  input: { userId: string; lastEventId: number; limit?: number | undefined },
): Promise<readonly SseEvent[]> {
  if (!UUID_RE.test(input.userId)) throw new RangeError('user id must be a uuid');
  if (!Number.isInteger(input.lastEventId) || input.lastEventId < 0) {
    throw new RangeError('last event id must be an integer ≥ 0');
  }
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new RangeError('limit must be 1..500');
  }
  const found = await client.query<{ event_id: string; event_type: string; payload: Record<string, string> }>(
    `select event_id::text, event_type, payload from sse_events
     where user_id = $1::uuid and event_id > $2::bigint
       and created_at > now() - ($3::integer || ' minutes')::interval
     order by event_id limit $4::integer`,
    [input.userId, input.lastEventId, SSE_REPLAY_MINUTES, limit],
  );
  return found.rows.map((r) => ({
    eventId: Number(r.event_id),
    type: r.event_type,
    payload: r.payload,
  }));
}
