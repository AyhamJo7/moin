/**
 * Outbox dispatcher (P08.02.02, ADR-0007): turns committed outbox rows into jobs.
 *
 * Two roles, so a dispatcher bug cannot reach tenant data (`00-roles.sql`):
 * - the **dispatcher pool** (`moin_dispatcher`: SELECT and UPDATE on `outbox`, nothing else)
 *   claims a tenant's due rows `FOR UPDATE SKIP LOCKED` and marks them dispatched;
 * - the **app pool** (`moin_app`) pages tenants through the reviewed register and writes the job
 *   row, each inside `withTenant`.
 *
 * Per event, inside the dispatcher's tenant transaction, which holds the row:
 * 1. the event type is routed to a job type; an unrouted event fails and backs off, undispatched;
 * 2. the job row is written and committed in its own app-pool transaction, with the outbox id
 *    (a UUIDv7) as job id and correlation id. A retry finds that job and checks it is this event's
 *    job of this type and version; one that is not stays undispatched and backs off;
 * 3. the job's envelope, built from its ledger row, is sent to the queue that row names, within a
 *    deadline;
 * 4. the row is marked dispatched and the transaction commits.
 *
 * The consumer never receives an envelope before its job row is committed. A crash after step 2
 * leaves the row undispatched and the next tick sends; a crash after step 3 sends a second
 * envelope with the same identity, which the consumer runs once (P08.02.04, FS-01). On shutdown
 * no further row is taken, and an in-flight send ends at its deadline.
 *
 * A handler of a routed event calls `outboxEventSuperseded` first, so an event that backed off and
 * arrives after a newer version of the same aggregate changes nothing (P08.02.04).
 */

import {
  dispatchOutboxBatch,
  enqueueJob,
  registeredTenants,
  withTenant,
  type OutboxEvent,
  type TenantClient,
} from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { JOB_TYPES, lintEnvelope, queueFor, type JobType, type JobEnvelope } from '@moin/kernel';
import type { JobQueue } from '@moin/integrations';
import type { Logger } from '@moin/observability';

const JOB_VERSION = 1;

export interface OutboxDispatcherOptions {
  /** Pause between ticks. */
  readonly intervalMs: number;
  /** Tenants per register page. */
  readonly tenantPageSize: number;
  /** Outbox rows claimed per tenant per tick. */
  readonly batchSize: number;
  /** A send that has not finished by then fails, and the row backs off. */
  readonly sendTimeoutMs: number;
}

export interface OutboxDispatcherDeps {
  readonly appPool: Pool;
  readonly dispatcherPool: Pool;
  /**
   * The queue of each workload a ledger row can name (`queueFor`, P08.01.02). Every route's
   * workload must be here, or the dispatcher refuses to be built.
   */
  readonly queues: ReadonlyMap<string, JobQueue>;
  /** Outbox event type to the job that handles it. An event type not listed is not published. */
  readonly routes: ReadonlyMap<string, JobType>;
  readonly logger: Logger;
  readonly isShuttingDown?: (() => boolean) | undefined;
  readonly options: OutboxDispatcherOptions;
}

export interface DispatchReport {
  readonly tenants: number;
  readonly published: number;
  readonly failedTenants: number;
}

export class UnroutedEventError extends Error {
  public override readonly name = 'UnroutedEventError';
}

/** The job under the event's id is not this event's job of this type and version. */
export class JobIdentityConflictError extends Error {
  public override readonly name = 'JobIdentityConflictError';
}

interface LedgerJob {
  readonly type: string;
  readonly version: number;
  readonly correlation_id: string;
  readonly queue_name: string;
  readonly payload: Record<string, string>;
}

export class OutboxDispatcher {
  readonly #deps: OutboxDispatcherDeps;
  #stopping = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  public constructor(deps: OutboxDispatcherDeps) {
    for (const type of deps.routes.values()) {
      if (!deps.queues.has(queueFor(type))) {
        throw new Error(`no queue is configured for the ${queueFor(type)} workload of a route`);
      }
    }
    this.#deps = deps;
  }

  public start(): void {
    if (this.#loop !== undefined) throw new Error('dispatcher already started');
    this.#loop = this.#run();
  }

  /** Stops claiming; the tenant being dispatched finishes its transaction first. */
  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#wake?.();
    await this.#loop;
  }

  /** One pass over every registered tenant. */
  public async tick(): Promise<DispatchReport> {
    const { appPool, dispatcherPool, options, logger } = this.#deps;
    let tenants = 0;
    let published = 0;
    let failedTenants = 0;
    for await (const organisationId of registeredTenants(appPool, options.tenantPageSize)) {
      if (this.#halted()) break;
      tenants += 1;
      try {
        const result = await withTenant(dispatcherPool, organisationId, (client) =>
          dispatchOutboxBatch(
            client,
            (event) => this.#publish(organisationId, event),
            options.batchSize,
            () => this.#halted(),
          ),
        );
        published += result.published;
      } catch (error) {
        failedTenants += 1;
        logger.error({ err: error, outcome: 'dispatch failed' }, 'outbox dispatch failed');
      }
    }
    return { tenants, published, failedTenants };
  }

  async #publish(organisationId: string, event: OutboxEvent): Promise<void> {
    // The scope is the tenant being dispatched; RLS already hides every other tenant's rows, and a
    // row that claims another organisation is refused rather than published under it.
    if (event.organisationId !== organisationId) {
      throw new Error('outbox row outside the dispatching tenant');
    }
    const type = this.#deps.routes.get(event.eventType);
    if (type === undefined) {
      this.#deps.logger.warn(
        { outcome: 'unrouted', eventType: event.eventType },
        'outbox event has no job route; left undispatched',
      );
      throw new UnroutedEventError('outbox event type has no job route');
    }
    const { appPool } = this.#deps;
    // Read, then write: the dispatcher's transaction holds the outbox row, so no other dispatcher
    // handles this event meanwhile. A job already there is an earlier attempt that committed it
    // and stopped before the mark; it is checked below, never written again.
    const job = await withTenant(appPool, organisationId, async (client) => {
      const earlier = await ledgerJob(client, event.id);
      if (earlier !== undefined) return earlier;
      await enqueueJob(client, {
        jobId: event.id,
        type,
        version: JOB_VERSION,
        correlationId: event.id,
        payload: event.payload,
      });
      return ledgerJob(client, event.id);
    });
    if (
      job?.type !== type ||
      job.version !== JOB_VERSION ||
      job.correlation_id !== event.id.toLowerCase() ||
      !isJobType(job.type) ||
      !samePayload(job.payload, event.payload)
    ) {
      // A route changed between attempts, or the id is taken by another job: sending would hand
      // the consumer an envelope its ledger refuses, after the row was marked dispatched.
      this.#deps.logger.error(
        { outcome: 'job identity conflict', eventType: event.eventType },
        'outbox event id names a different job; left undispatched',
      );
      throw new JobIdentityConflictError('outbox event id names a different job');
    }
    const envelope: JobEnvelope = {
      jobId: event.id,
      type: job.type,
      version: job.version,
      organisationId,
      correlationId: job.correlation_id,
      traceContext: null,
      attempt: 0,
      notBefore: null,
      payload: job.payload,
    };
    // The envelope contract (ID-only payload, P08) is checked on every send, a resend included.
    const lint = lintEnvelope(envelope);
    const queue = this.#deps.queues.get(job.queue_name);
    if (!lint.ok || queue === undefined) {
      this.#deps.logger.error(
        { outcome: lint.ok ? 'no queue for workload' : 'envelope invalid' },
        'outbox event not sent; left undispatched',
      );
      throw new JobIdentityConflictError('outbox event cannot be sent as its job');
    }
    await this.#send(queue, JSON.stringify(envelope));
  }

  /** Sends within the deadline; at the deadline the request itself is aborted. */
  async #send(queue: JobQueue, body: string): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('queue send exceeded its deadline'));
      }, this.#deps.options.sendTimeoutMs);
    });
    try {
      await Promise.race([queue.send(body, {}, { signal: controller.signal }), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  #halted(): boolean {
    return this.#stopping || this.#deps.isShuttingDown?.() === true;
  }

  async #run(): Promise<void> {
    while (!this.#halted()) {
      try {
        await this.tick();
      } catch (error) {
        this.#deps.logger.error({ err: error, outcome: 'tick failed' }, 'outbox tick failed');
      }
      if (this.#halted()) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#deps.options.intervalMs);
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}

function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

async function ledgerJob(client: TenantClient, jobId: string): Promise<LedgerJob | undefined> {
  const found = await client.query<LedgerJob & Record<string, unknown>>(
    `select type, version, correlation_id::text, queue_name, payload
       from job_runs where id = $1::uuid`,
    [jobId],
  );
  return found.rows[0];
}

/** The ledger's payload is exactly the event's: same keys, same ids. */
function samePayload(
  stored: Readonly<Record<string, string>>,
  event: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(stored);
  return (
    keys.length === Object.keys(event).length &&
    keys.every((key) => Object.hasOwn(event, key) && event[key] === stored[key])
  );
}
