/**
 * Timers + sweeps (P08.07, ADR-0008): durable rows the 1-minute sweep leases.
 *
 * `scheduleTimer` is idempotent per (kind, ref_id): scheduling the same
 * reminder twice keeps one row (the earlier due_at wins — an earlier deadline
 * must never be pushed later by a repeat). `claimDueTimers` leases due rows
 * SKIP LOCKED with a bounded lease (P08.07.01/02); `completeTimer` marks done.
 * Exactly-once effect (P08.07.04) is the lease + the guarded complete: three
 * concurrent sweepers claim disjoint sets, and a completed row never re-fires.
 * Restarts/restores (P08.07.04) are rows: leases expire, due rows re-claim.
 *
 * Per-environment schedules (P08.07.02) are ops config, not code — the sweep
 * handler runs on Scheduler cron; this module is the row mechanics.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

/** Lease length: 5 minutes — longer than any sweep pass, shorter than any SLA. */
const LEASE_S = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface TimerRow {
  readonly id: string;
  readonly kind: string;
  readonly refId: string;
  readonly dueAt: Date;
  readonly attempts: number;
}

function checkKind(kind: string): string {
  const trimmed = kind.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError('timer kind must be 1..80 characters');
  }
  return trimmed;
}

/**
 * Schedule one timer: idempotent per (kind, ref) — repeats keep the row,
 * earlier due_at wins. Returns the row id either way.
 */
export async function scheduleTimer(
  client: TenantClient,
  input: { kind: string; refId: string; dueAt: Date },
): Promise<string> {
  const kind = checkKind(input.kind);
  if (!UUID_RE.test(input.refId)) throw new RangeError('timer ref must be a uuid');
  if (!Number.isFinite(input.dueAt.getTime())) throw new RangeError('due_at must be a date');
  const id = randomUUID();
  const done = await client.query<{ id: string }>(
    `insert into timers (organisation_id, id, kind, ref_id, due_at)
     values (app.current_org(), $1::uuid, $2::text, $3::uuid, $4::timestamptz)
     on conflict (organisation_id, kind, ref_id) do update
       set due_at = least(timers.due_at, excluded.due_at)
     returning id::text`,
    [id, kind, input.refId, input.dueAt.toISOString()],
  );
  const row = done.rows[0];
  if (row === undefined) throw new Error('timer schedule returned no row');
  return row.id;
}

/** Lease due rows: SKIP LOCKED, bounded lease, attempt bumped. */
export async function claimDueTimers(
  client: TenantClient,
  limit = 50,
): Promise<readonly TimerRow[]> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new RangeError('limit must be 1..200');
  }
  const found = await client.query<{
    id: string;
    kind: string;
    ref_id: string;
    due_at: string;
    attempts: number;
  }>(
    `update timers set lease_until = now() + ($1::integer || ' seconds')::interval,
       attempts = attempts + 1
     where id in (
       select id from timers
       where done_at is null and due_at <= now()
         and (lease_until is null or lease_until <= now())
       order by due_at, id limit $2::integer
       for update skip locked
     )
     returning id::text, kind, ref_id::text, due_at::text, attempts`,
    [LEASE_S, limit],
  );
  return found.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    refId: r.ref_id,
    dueAt: new Date(r.due_at),
    attempts: r.attempts,
  }));
}

/** Mark done: guarded flip — a double complete is a no-op false, never an error. */
export async function completeTimer(client: TenantClient, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) throw new RangeError('timer id must be a uuid');
  const done = await client.query<{ id: string }>(
    `update timers set done_at = now()
     where id = $1::uuid and done_at is null returning id::text`,
    [id],
  );
  return done.rows[0] !== undefined;
}
