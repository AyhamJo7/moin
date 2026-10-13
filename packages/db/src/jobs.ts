/**
 * Job envelope ledger (P08.01, ADR-0008): enqueue + claim inside tenant transactions.
 *
 * The envelope is validated by @moin/kernel's lintEnvelope before any write —
 * the DB CHECKs are the second half, never the only half. Payloads are ID-only
 * (kernel refuses content); the handler re-reads rows inside `withTenant`.
 *
 * Claims use SKIP LOCKED so several workers share the queues without stepping
 * on each other; claim + status flip is one guarded UPDATE (stale claim 409s).
 */

import {
  lintEnvelope,
  queueFor,
  type JobEnvelope,
  type JobType,
} from '@moin/kernel';
import type { TenantClient } from './tenant.ts';

export class JobConflictError extends Error {
  public override readonly name = 'JobConflictError';
}

export interface EnqueueInput {
  readonly jobId: string;
  readonly type: JobType;
  readonly version?: number | undefined;
  readonly correlationId: string;
  readonly traceContext?: string | null | undefined;
  readonly notBefore?: Date | null | undefined;
  readonly payload?: Readonly<Record<string, string>> | undefined;
}

export interface JobRow {
  readonly id: string;
  readonly type: JobType;
  readonly queue: string;
  readonly status: string;
  readonly attempt: number;
}

/** Enqueue one envelope: validated, ID-only, queued. Duplicate jobId is a 409. */
export async function enqueueJob(client: TenantClient, input: EnqueueInput): Promise<JobRow> {
  const envelope: JobEnvelope = {
    jobId: input.jobId,
    type: input.type,
    version: input.version ?? 1,
    organisationId: '00000000-0000-4000-8000-000000000000',
    correlationId: input.correlationId,
    traceContext: input.traceContext ?? null,
    attempt: 0,
    notBefore: input.notBefore?.toISOString() ?? null,
    payload: input.payload ?? {},
  };
  const lint = lintEnvelope({ ...envelope, organisationId: null });
  if (!lint.ok) throw new RangeError(`envelope: ${lint.errors.join('; ')}`);
  const queue = queueFor(input.type);
  try {
    const done = await client.query<{ id: string; status: string; attempt: number }>(
      `insert into job_runs
         (organisation_id, id, type, version, correlation_id, trace_context,
          not_before, payload, queue_name, status)
       values (app.current_org(), $1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8, 'queued')
       returning id::text, status, attempt`,
      [
        input.jobId,
        input.type,
        input.version ?? 1,
        input.correlationId,
        input.traceContext ?? null,
        input.notBefore?.toISOString() ?? null,
        JSON.stringify(input.payload ?? {}),
        queue,
      ],
    );
    const row = done.rows[0];
    if (row === undefined) throw new Error('job insert returned no row');
    return { id: row.id, type: input.type, queue, status: row.status, attempt: row.attempt };
  } catch (error) {
    if (error instanceof Error && /duplicate|unique/i.test(error.message)) {
      throw new JobConflictError('job id already enqueued');
    }
    throw error;
  }
}

/**
 * Claim the next due job: SKIP LOCKED, attempt bumped, due-only. A string
 * argument keeps the call short; the object form narrows to one job type on
 * a shared queue (sweeps holds sweep-run + retention-purge + reverify-sweep).
 */
export async function claimJob(
  client: TenantClient,
  input: string | { queue: string; type?: JobType | undefined },
): Promise<JobRow | null> {
  const queue = typeof input === 'string' ? input : input.queue;
  const type = typeof input === 'string' ? undefined : input.type;
  const found = await client.query<{ id: string; type: string; status: string; attempt: number }>(
    `update job_runs set status = 'claimed', claimed_at = now(), attempt = attempt + 1
     where id = (
       select id from job_runs
       where organisation_id = app.current_org() and queue_name = $1 and status = 'queued'
         and ($2::text is null or type = $2::text)
         and (not_before is null or not_before <= now())
       order by created_at, id limit 1
       for update skip locked
     )
     returning id::text, type, status, attempt`,
    [queue, type ?? null],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    type: row.type as JobType,
    queue,
    status: row.status,
    attempt: row.attempt,
  };
}
