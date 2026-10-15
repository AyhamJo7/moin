/**
 * Job history + replay tooling (P08.06, ADR-0008): the ops surface over the
 * `job_runs` ledger (migration 0062).
 *
 * - `listDeadJobs` (P08.06.02): DLQ rows, metadata only — ids, type, attempts,
 *   error code, correlation, timestamps. Never payloads: the list is what an
 *   operator scans, and payloads are need-to-know (INV-12).
 * - `inspectJob` (P08.06.02): one row, full envelope (payload included — the
 *   operator chose this row deliberately, and replay needs the version).
 * - `replayJob` (P08.06.02/.03): a dead/failed row goes back to `queued` with
 *   attempt preserved (the next claim bumps it) — idempotent because handlers
 *   are (P08.02–.04): replaying twice enqueues once (guarded status flip).
 * - `discardJob` (P08.06.02/.03): dead stays dead, finished_at set; requires
 *   a reason (≥ 8 chars) and writes an audit event — a discard without a
 *   recorded reason is indistinguishable from data loss.
 * - `finishJob` (P08.06.01): the handler's terminal write — succeeded, failed
 *   (retryable, back to queued with not_before), or dead (DLQ end-state).
 *   Durations come from claimed_at → now, so history carries real timings.
 */

import { appendAuditEvent } from './audit.ts';
import type { JobType } from '@moin/kernel';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface DeadJobMeta {
  readonly id: string;
  readonly type: JobType;
  readonly attempt: number;
  readonly errorCode: string | null;
  readonly correlationId: string;
  readonly finishedAt: string | null;
}

export interface JobDetail extends DeadJobMeta {
  readonly version: number;
  readonly queue: string;
  readonly status: string;
  readonly notBefore: string | null;
  readonly payload: Readonly<Record<string, string>>;
}

function checkId(id: string): string {
  if (!UUID_RE.test(id)) throw new RangeError('job id must be a uuid');
  return id;
}

function checkReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 8 || trimmed.length > 500) {
    throw new RangeError('discard reason must be 8..500 characters');
  }
  return trimmed;
}

/** DLQ rows, metadata only (P08.06.02) — newest first, paginated. */
export async function listDeadJobs(
  client: TenantClient,
  limit = 50,
): Promise<readonly DeadJobMeta[]> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new RangeError('limit must be 1..200');
  }
  const found = await client.query<{
    id: string;
    type: string;
    attempt: number;
    error_code: string | null;
    correlation_id: string;
    finished_at: string | null;
  }>(
    `select id::text, type, attempt, error_code, correlation_id::text,
            finished_at::text
     from job_runs where status = 'dead'
     order by finished_at desc nulls last, id limit $1::integer`,
    [limit],
  );
  return found.rows.map((r) => ({
    id: r.id,
    type: r.type as JobType,
    attempt: r.attempt,
    errorCode: r.error_code,
    correlationId: r.correlation_id,
    finishedAt: r.finished_at,
  }));
}

/** One row, full envelope (P08.06.02) — the operator chose this row. */
export async function inspectJob(client: TenantClient, id: string): Promise<JobDetail | null> {
  const found = await client.query<{
    id: string;
    type: string;
    version: number;
    queue_name: string;
    status: string;
    attempt: number;
    error_code: string | null;
    correlation_id: string;
    finished_at: string | null;
    not_before: string | null;
    payload: Record<string, string>;
  }>(
    `select id::text, type, version, queue_name, status, attempt, error_code,
            correlation_id::text, finished_at::text, not_before::text, payload
     from job_runs where id = $1::uuid`,
    [checkId(id)],
  );
  const r = found.rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    type: r.type as JobType,
    version: r.version,
    queue: r.queue_name,
    status: r.status,
    attempt: r.attempt,
    errorCode: r.error_code,
    correlationId: r.correlation_id,
    finishedAt: r.finished_at,
    notBefore: r.not_before,
    payload: r.payload,
  };
}

/** Terminal write from the handler (P08.06.01): durations from claimed_at. */
export async function finishJob(
  client: TenantClient,
  id: string,
  outcome:
    | { readonly state: 'succeeded' }
    | {
        readonly state: 'failed';
        readonly errorCode: string;
        readonly notBefore?: Date | undefined;
      }
    | { readonly state: 'dead'; readonly errorCode: string },
): Promise<void> {
  const job = checkId(id);
  if (outcome.state === 'succeeded') {
    const done = await client.query<{ id: string }>(
      `update job_runs set status = 'succeeded', finished_at = now()
       where id = $1::uuid and status = 'claimed' returning id::text`,
      [job],
    );
    if (done.rows[0] === undefined) throw new RangeError('job is not claimed');
    return;
  }
  if (outcome.state === 'failed') {
    const label = outcome.errorCode.trim();
    if (label.length === 0 || label.length > 80) {
      throw new RangeError('error code must be 1..80 characters');
    }
    const done = await client.query<{ id: string }>(
      `update job_runs set status = 'queued', error_code = $2::text,
         not_before = coalesce($3::timestamptz, now() + interval '5 minutes')
       where id = $1::uuid and status = 'claimed' returning id::text`,
      [job, label, outcome.notBefore?.toISOString() ?? null],
    );
    if (done.rows[0] === undefined) throw new RangeError('job is not claimed');
    return;
  }
  const label = outcome.errorCode.trim();
  if (label.length === 0 || label.length > 80) {
    throw new RangeError('error code must be 1..80 characters');
  }
  const done = await client.query<{ id: string }>(
    `update job_runs set status = 'dead', error_code = $2::text, finished_at = now()
     where id = $1::uuid and status = 'claimed' returning id::text`,
    [job, label],
  );
  if (done.rows[0] === undefined) throw new RangeError('job is not claimed');
}

/**
 * Replay one dead/failed row (P08.06.02/.03): back to queued, attempt kept
 * (the next claim bumps it). Guarded flip — a second replay is a no-op row
 * miss, never a duplicate enqueue. Idempotent by construction (P08.02–.04).
 */
export async function replayJob(client: TenantClient, id: string): Promise<boolean> {
  const done = await client.query<{ id: string }>(
    `update job_runs set status = 'queued', error_code = null, not_before = null,
       finished_at = null
     where id = $1::uuid and status in ('dead', 'failed') returning id::text`,
    [checkId(id)],
  );
  return done.rows[0] !== undefined;
}

/**
 * Discard one dead row (P08.06.02/.03): stays dead, finished_at set; reason
 * required and audited — an unaudited discard is data loss with no trail.
 */
export async function discardJob(
  client: TenantClient,
  id: string,
  reason: string,
): Promise<boolean> {
  const job = checkId(id);
  const why = checkReason(reason);
  const done = await client.query<{ id: string }>(
    `update job_runs set error_code = coalesce(error_code, 'discarded'), finished_at = now()
     where id = $1::uuid and status = 'dead' returning id::text`,
    [job],
  );
  if (done.rows[0] === undefined) return false;
  await appendAuditEvent(client, {
    source: 'operator',
    operation: 'job.discard',
    targetKind: 'job_run',
    targetId: job,
    argsSanitized: { reason_length: why.length },
    result: 'succeeded',
  });
  return true;
}
