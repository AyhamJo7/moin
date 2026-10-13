/**
 * Transactional outbox + dispatcher (P08.02, ADR-0007).
 *
 * Insert rides the business transaction (P08.02.01): the caller inserts the
 * domain row and the outbox row with the same client, one commit. The
 * dispatcher (P08.02.02, `moin_dispatcher`) claims due batches SKIP LOCKED,
 * hands them to `publish` (SQS in workers, a stub in tests), marks
 * dispatched; failures back off via next_attempt_at.
 *
 * Crash-between-publish-and-mark (P08.02.04) is tolerated, not prevented:
 * the row stays undispatched, the next sweep republishes, and consumers are
 * idempotent (UNIQUE per aggregate+version, handlers keyed the same way).
 * Per-aggregate ordering holds via aggregate_ver checks at the consumer —
 * the outbox preserves the version, it does not sequence delivery.
 *
 * `outboxLagSeconds` (P08.02.03) is the dispatcher's oldest-undispatched age;
 * the alarm (> 2 min) lives in ops, this function is its input.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Backoff between dispatch attempts: 30s, 2m, 8m, capped at 30m. */
const BACKOFF_S = [30, 120, 480, 1800];

export interface OutboxEvent {
  readonly id: string;
  readonly organisationId: string;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly attempts: number;
}

export interface PublishResult {
  readonly published: number;
}

function checkLabel(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError(`${what} must be 1..80 characters`);
  }
  return trimmed;
}

function checkPayload(payload: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (key.length === 0 || key.length > 64) {
      throw new RangeError(`payload key "${key}" must be 1..64 characters`);
    }
    if (!UUID_RE.test(value)) throw new RangeError(`payload["${key}"] must be a uuid`);
  }
}

/** Insert one outbox row with the caller's client — same txn as the domain write. */
export async function insertOutboxEvent(
  client: TenantClient,
  input: {
    aggregate: string;
    aggregateId: string;
    aggregateVersion: number;
    eventType: string;
    payload?: Readonly<Record<string, string>> | undefined;
  },
): Promise<string> {
  const aggregate = checkLabel(input.aggregate, 'aggregate');
  const eventType = checkLabel(input.eventType, 'event type');
  if (!UUID_RE.test(input.aggregateId)) throw new RangeError('aggregate id must be a uuid');
  if (!Number.isInteger(input.aggregateVersion) || input.aggregateVersion < 1) {
    throw new RangeError('aggregate version must be an integer ≥ 1');
  }
  checkPayload(input.payload ?? {});
  const id = randomUUID();
  await client.query(
    `insert into outbox
       (id, organisation_id, aggregate, aggregate_id, aggregate_ver, event_type, payload)
     values ($1, app.current_org(), $2, $3, $4, $5, $6::jsonb)`,
    [
      id,
      aggregate,
      input.aggregateId,
      input.aggregateVersion,
      eventType,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return id;
}

/** Oldest undispatched age in seconds (P08.02.03) — null when fully drained. */
export async function outboxLagSeconds(client: TenantClient): Promise<number | null> {
  const found = await client.query<{ lag_s: number | null }>(
    `select coalesce(extract(epoch from now() - min(created_at)), 0)::integer as lag_s
     from outbox where dispatched_at is null and organisation_id = app.current_org()`,
  );
  const empty = await client.query<{ n: string }>(
    `select count(*)::text as n from outbox
     where dispatched_at is null and organisation_id = app.current_org()`,
  );
  if (empty.rows[0]?.['n'] === '0') return null;
  const lag = found.rows[0]?.['lag_s'];
  return typeof lag === 'number' ? lag : 0;
}

/**
 * Dispatch one batch: claim due rows SKIP LOCKED, publish each, mark
 * dispatched; on publish failure bump attempts + next_attempt_at (backoff).
 * Returns the published count.
 *
 * Tenant scoping is the CALLER's job: pass a `withTenant` client and only
 * that tenant's rows are visible (outbox.organisation_id is a plain column —
 * the table is global by dispatcher design, ADR-0007 — so the WHERE clause
 * below, not RLS, enforces the boundary). Workers iterate tenants via
 * `withSystemWork` (P08.02.02); tests pass the tenant client directly.
 */
export async function dispatchOutboxBatch(
  client: TenantClient,
  publish: (event: OutboxEvent) => Promise<void>,
  limit = 50,
): Promise<PublishResult> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new RangeError('limit must be 1..200');
  }
  const claimed = await client.query<{
    id: string;
    organisation_id: string;
    aggregate: string;
    aggregate_id: string;
    aggregate_ver: number;
    event_type: string;
    payload: Record<string, string>;
    attempts: number;
  }>(
    `select id::text, organisation_id::text, aggregate, aggregate_id::text,
            aggregate_ver, event_type, payload, attempts
     from outbox
     where dispatched_at is null
       and organisation_id = app.current_org()
       and (next_attempt_at is null or next_attempt_at <= now())
     order by created_at, id limit $1::integer
     for update skip locked`,
    [limit],
  );
  let published = 0;
  for (const row of claimed.rows) {
    const event: OutboxEvent = {
      id: row.id,
      organisationId: row.organisation_id,
      aggregate: row.aggregate,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_ver,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
    };
    try {
      await publish(event);
      await client.query(`update outbox set dispatched_at = now() where id = $1::uuid`, [row.id]);
      published += 1;
    } catch {
      const backoff = BACKOFF_S[Math.min(row.attempts, BACKOFF_S.length - 1)] ?? 1800;
      await client.query(
        `update outbox set attempts = attempts + 1,
           next_attempt_at = now() + ($1::integer || ' seconds')::interval
         where id = $2::uuid`,
        [backoff, row.id],
      );
    }
  }
  return { published };
}
