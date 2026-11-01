/**
 * Job execution against the `job_runs` ledger (P08.05, ADR-0008, INV-11, INV-19).
 *
 * One tenant transaction per delivery, and its row lock is the execution lease:
 *
 *   1. `select … for update skip locked` takes the job row. A second worker racing on the same job
 *      gets no row, finds the job exists, and reports `busy` — it never runs the handler.
 *   2. A job already `succeeded` is a duplicate delivery: nothing runs, the caller deletes the
 *      message. A job already `dead` asks the caller to make sure the DLQ copy exists.
 *   3. The claim (`attempt + 1`, `claimed`) and the handler's own writes happen in this same
 *      transaction. The handler runs inside a savepoint: if it throws, only its writes are rolled
 *      back, the claim stays, and the failure outcome is written before the commit.
 *   4. `succeeded` is written in the transaction that holds the handler's effects. A crash before
 *      the commit rolls everything back, so redelivery runs the handler again on a clean slate; a
 *      crash after the commit and before the queue delete finds `succeeded` and does not repeat
 *      the effect.
 *
 * A worker that died mid-transaction releases its lock with the connection, so a stale `claimed`
 * row is simply re-claimed by whoever receives the redelivered message. The lock, not a timestamp,
 * decides who is running, so no stale worker can overwrite a newer execution.
 *
 * External side effects inside a handler (a provider call) are not rolled back with the
 * transaction: they must carry their own idempotency key (INV-11).
 */

import { classifyFailure, decideRetry, type JobType } from '@moin/kernel';
import { finishJob } from './job-history.ts';
import { withTenant } from './tenant.ts';
import type { TenantClient } from './tenant.ts';
import type { Pool } from './pool.ts';

/** The job as the handler sees it: ledger values, never the queue message's. */
export interface ClaimedJob {
  readonly id: string;
  readonly type: JobType;
  readonly version: number;
  readonly organisationId: string;
  readonly correlationId: string;
  readonly traceContext: string | null;
  readonly attempt: number;
  readonly payload: Readonly<Record<string, string>>;
}

export interface JobExecutionContext {
  readonly client: TenantClient;
  readonly job: ClaimedJob;
}

export type JobHandler = (context: JobExecutionContext) => Promise<void>;

/** What the consumer must do with the queue message afterwards. */
export type JobExecutionResult =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'deferred'; readonly seconds: number }
  | { readonly kind: 'retry'; readonly delaySeconds: number; readonly errorCode: string }
  | { readonly kind: 'dead'; readonly errorCode: string; readonly alreadyDead: boolean }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'mismatch' };

export interface JobExecutionRequest extends JobIdentity {
  readonly handler: JobHandler;
  readonly random?: (() => number) | undefined;
}

interface LedgerRow extends Record<string, unknown> {
  id: string;
  type: string;
  version: number;
  correlation_id: string;
  trace_context: string | null;
  status: string;
  attempt: number;
  payload: Record<string, string>;
  defer_seconds: number | null;
}

const HANDLER_SAVEPOINT = 'job_handler';

/** Upper bound for one deferral, so a far-future `not_before` is re-checked rather than trusted. */
export const MAX_DEFER_SECONDS = 12 * 60 * 60;

/** What a queue message claims about a job; the ledger row is authoritative and must agree. */
interface JobIdentity {
  readonly jobId: string;
  readonly organisationId: string;
  readonly type: JobType;
  readonly version: number;
  readonly correlationId: string;
}

type LockedJob =
  | { readonly kind: 'row'; readonly row: LedgerRow }
  | { readonly kind: 'busy' | 'unknown' | 'mismatch' };

/**
 * Takes the job row lock without waiting and checks the claimed identity against the ledger. Every
 * path that changes a job's state goes through here, so none can act on a row the message does
 * not describe (INV-02): execution and abandonment share this one check.
 */
async function lockJob(client: TenantClient, identity: JobIdentity): Promise<LockedJob> {
  const locked = await client.query<LedgerRow>(
    `select id::text, type, version, correlation_id::text, trace_context, status, attempt,
            payload,
            case when not_before > now()
                 then ceil(extract(epoch from (not_before - now())))::integer end
              as defer_seconds
     from job_runs where id = $1::uuid for update skip locked`,
    [identity.jobId],
  );
  const row = locked.rows[0];
  if (row === undefined) {
    // Locked by a competing worker, or not visible to this tenant (absent or another
    // organisation's). The unlocked read tells the two apart; RLS answers for the tenant.
    const exists = await client.query(`select 1 from job_runs where id = $1::uuid`, [
      identity.jobId,
    ]);
    return { kind: exists.rows.length > 0 ? 'busy' : 'unknown' };
  }
  if (
    row.type !== identity.type ||
    row.version !== identity.version ||
    row.correlation_id !== identity.correlationId.toLowerCase()
  ) {
    return { kind: 'mismatch' };
  }
  return { kind: 'row', row };
}

export async function executeJob(
  pool: Pool,
  request: JobExecutionRequest,
): Promise<JobExecutionResult> {
  return withTenant(
    pool,
    request.organisationId,
    async (client) => {
      const locked = await lockJob(client, request);
      if (locked.kind !== 'row') return { kind: locked.kind };
      const row = locked.row;
      if (row.status === 'succeeded') return { kind: 'duplicate' };
      if (row.status === 'dead') {
        return { kind: 'dead', errorCode: 'already-dead', alreadyDead: true };
      }
      if (row.defer_seconds !== null) {
        return { kind: 'deferred', seconds: Math.min(row.defer_seconds, MAX_DEFER_SECONDS) };
      }

      const claimed = await client.query<{ attempt: number }>(
        `update job_runs set status = 'claimed', claimed_at = now(), attempt = attempt + 1,
                finished_at = null
         where id = $1::uuid returning attempt`,
        [request.jobId],
      );
      const attempt = claimed.rows[0]?.attempt;
      if (attempt === undefined) throw new Error('job claim returned no row');
      const job: ClaimedJob = {
        id: row.id,
        type: request.type,
        version: row.version,
        organisationId: request.organisationId,
        correlationId: row.correlation_id,
        traceContext: row.trace_context,
        attempt,
        payload: row.payload,
      };

      await client.query(`savepoint ${HANDLER_SAVEPOINT}`);
      try {
        await request.handler({ client, job });
        await client.query(`release savepoint ${HANDLER_SAVEPOINT}`);
      } catch (error) {
        await client.query(`rollback to savepoint ${HANDLER_SAVEPOINT}`);
        return recordFailure(client, job, classifyFailure(error), request.random);
      }
      await finishJob(client, job.id, { state: 'succeeded' });
      return { kind: 'succeeded' };
    },
    { correlationId: request.correlationId },
  );
}

async function recordFailure(
  client: TenantClient,
  job: ClaimedJob,
  failure: { readonly code: string; readonly permanent: boolean },
  random: (() => number) | undefined,
): Promise<JobExecutionResult> {
  // The ledger counts this run already; the policy counts failures before it.
  const decision = failure.permanent
    ? { toDlq: true, delaySeconds: 0 }
    : decideRetry(job.type, job.attempt - 1, random);
  if (decision.toDlq) {
    await finishJob(client, job.id, { state: 'dead', errorCode: failure.code });
    return { kind: 'dead', errorCode: failure.code, alreadyDead: false };
  }
  await finishJob(client, job.id, {
    state: 'failed',
    errorCode: failure.code,
    notBefore: new Date(Date.now() + decision.delaySeconds * 1000),
  });
  return { kind: 'retry', delaySeconds: decision.delaySeconds, errorCode: failure.code };
}

export interface JobAbandonRequest extends JobIdentity {
  readonly errorCode: string;
}

/** Why the consumer may, or may not, acknowledge a delivery that crossed the receive ceiling. */
export type JobAbandonResult =
  | { readonly kind: 'abandoned' }
  | { readonly kind: 'already-terminal'; readonly status: 'succeeded' | 'dead' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'mismatch' };

/**
 * Ends a job whose deliveries keep failing without ever reaching the retry policy (a handler that
 * kills its own transaction rolls the attempt counter back with it). Takes no lock it would have
 * to wait for: a row a live transaction holds is `busy` and is left to that transaction. The
 * request carries the same identity as execution and a mismatch changes nothing.
 */
export async function abandonJob(
  pool: Pool,
  request: JobAbandonRequest,
): Promise<JobAbandonResult> {
  return withTenant(pool, request.organisationId, async (client) => {
    const locked = await lockJob(client, request);
    if (locked.kind !== 'row') return { kind: locked.kind };
    const { status } = locked.row;
    if (status === 'succeeded' || status === 'dead') {
      return { kind: 'already-terminal', status };
    }
    await client.query(
      `update job_runs set status = 'dead', error_code = $2::text, finished_at = now()
       where id = $1::uuid`,
      [request.jobId, request.errorCode],
    );
    return { kind: 'abandoned' };
  });
}
