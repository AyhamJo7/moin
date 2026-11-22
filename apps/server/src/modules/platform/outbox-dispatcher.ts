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
 * 2. the job row is written and committed in its own app-pool transaction, with the outbox id as
 *    job id and correlation id, so a retry finds the same job (`JobConflictError`);
 * 3. the envelope is sent to the jobs queue;
 * 4. the row is marked dispatched and the transaction commits.
 *
 * The consumer never receives an envelope before its job row is committed. A crash after step 2
 * leaves the row undispatched and the next tick sends; a crash after step 3 sends a second
 * envelope with the same identity, which the consumer runs once (P08.02.04, FS-01).
 */

import {
  dispatchOutboxBatch,
  enqueueJob,
  JobConflictError,
  registeredTenants,
  withTenant,
  type OutboxEvent,
} from '@moin/db';
import type { Pool } from '@moin/db/pool';
import type { JobType, JobEnvelope } from '@moin/kernel';
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
}

export interface OutboxDispatcherDeps {
  readonly appPool: Pool;
  readonly dispatcherPool: Pool;
  readonly queue: JobQueue;
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

export class OutboxDispatcher {
  readonly #deps: OutboxDispatcherDeps;
  #stopping = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  public constructor(deps: OutboxDispatcherDeps) {
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
    const envelope: JobEnvelope = {
      jobId: event.id,
      type,
      version: JOB_VERSION,
      organisationId,
      correlationId: event.id,
      traceContext: null,
      attempt: 0,
      notBefore: null,
      payload: event.payload,
    };
    try {
      await withTenant(this.#deps.appPool, organisationId, (client) =>
        enqueueJob(client, {
          jobId: envelope.jobId,
          type,
          version: JOB_VERSION,
          correlationId: envelope.correlationId,
          payload: envelope.payload,
        }),
      );
    } catch (error) {
      // An earlier attempt committed the job and stopped before marking the row: send again.
      if (!(error instanceof JobConflictError)) throw error;
    }
    await this.#deps.queue.send(JSON.stringify(envelope));
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
