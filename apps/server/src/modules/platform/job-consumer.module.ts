/**
 * Wires the job consumer into the worker role (P08.05.01).
 *
 * The worker holds a `moin_app` pool (NOBYPASSRLS, owning no tables) that is only ever used inside
 * `withTenant`, via `executeJob`. The queue connection is resolved at startup, so a missing queue
 * or a mistyped name refuses to start (`ConfigurationError`) instead of polling nothing.
 *
 * The registry is empty in this slice: no production job type has a handler yet (the post-call
 * finaliser arrives with its own slice). A delivery for a type without a handler is recorded as a
 * transient `handler-unavailable` failure and follows the retry schedule to the DLQ; it is never
 * acknowledged as processed.
 *
 * The outbox dispatcher (P08.02.02) runs here too, on its own `moin_dispatcher` pool, when
 * `DISPATCHER_DATABASE_URL` is set; unset, it does not run and the worker says so once at startup.
 * Its route table is empty until a production event type has a job: an unrouted event stays in
 * the outbox, backing off, and is never published.
 */

import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createPool, type Pool } from '@moin/db/pool';
import { connectSqsQueues, type SqsQueues } from '@moin/integrations';
import type { JobType } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, type Config } from '../../config/env.ts';
import { HealthModule } from '../../health/health.module.ts';
import { SHUTDOWN_STATE } from '../../health/health.tokens.ts';
import type { ShutdownState } from '../../health/shutdown-state.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { JobConsumer, JobHandlerRegistry } from './job-consumer.ts';
import { OutboxDispatcher } from './outbox-dispatcher.ts';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');
const WORKER_POOL = Symbol('WORKER_POOL');
const JOB_QUEUES = Symbol('JOB_QUEUES');
const DISPATCHER_POOL = Symbol('DISPATCHER_POOL');

/** Outbox event type to job type. Empty until a production event has a handler. */
const OUTBOX_ROUTES: ReadonlyMap<string, JobType> = new Map();
const OUTBOX_INTERVAL_MS = 2_000;
const OUTBOX_TENANT_PAGE = 100;
const OUTBOX_BATCH = 50;
const DISPATCHER_POOL_MAX = 2;
const DISPATCHER_ROLE = 'moin_dispatcher';

const POOL_MAX_CONNECTIONS = 10;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
/** Per statement; a handler's transaction holds its job row lock, so a hung query must end. */
const STATEMENT_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;
/** Time left of the grace period for in-flight deliveries after the drain wait. */
const GRACE_RESERVE_MS = 1_000;

@Injectable()
class JobConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  readonly #consumer: JobConsumer;

  public constructor(
    @Inject(WORKER_POOL) pool: Pool,
    @Inject(JOB_QUEUES) queues: SqsQueues,
    @Inject(JOB_HANDLERS) handlers: JobHandlerRegistry,
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) logger: Logger,
    @Inject(SHUTDOWN_STATE) shutdownState: ShutdownState,
  ) {
    this.#consumer = new JobConsumer({
      pool,
      queue: queues.jobs,
      deadLetter: queues.deadLetter,
      handlers,
      logger,
      isShuttingDown: () => shutdownState.isShuttingDown(),
      options: {
        concurrency: config.JOB_CONCURRENCY,
        visibilitySeconds: config.JOB_VISIBILITY_SECONDS,
        waitSeconds: config.JOB_POLL_WAIT_SECONDS,
        handlerDeadlineSeconds: config.JOB_HANDLER_DEADLINE_SECONDS,
        drainTimeoutMs: Math.max(config.SHUTDOWN_GRACE_MS - GRACE_RESERVE_MS, 0),
      },
    });
  }

  public onApplicationBootstrap(): void {
    this.#consumer.start();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.#consumer.stop();
  }
}

@Injectable()
class OutboxDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  readonly #dispatcher: OutboxDispatcher | null;

  public constructor(
    @Inject(WORKER_POOL) appPool: Pool,
    @Inject(DISPATCHER_POOL) private readonly dispatcherPool: Pool | null,
    @Inject(JOB_QUEUES) queues: SqsQueues,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SHUTDOWN_STATE) shutdownState: ShutdownState,
  ) {
    this.#dispatcher =
      dispatcherPool === null
        ? null
        : new OutboxDispatcher({
            appPool,
            dispatcherPool,
            queue: queues.jobs,
            routes: OUTBOX_ROUTES,
            logger,
            isShuttingDown: () => shutdownState.isShuttingDown(),
            options: {
              intervalMs: OUTBOX_INTERVAL_MS,
              tenantPageSize: OUTBOX_TENANT_PAGE,
              batchSize: OUTBOX_BATCH,
            },
          });
  }

  public async onApplicationBootstrap(): Promise<void> {
    if (this.#dispatcher === null || this.dispatcherPool === null) {
      this.logger.warn(
        { outcome: 'outbox dispatcher off' },
        'DISPATCHER_DATABASE_URL is not set; the outbox is not dispatched',
      );
      return;
    }
    // A credential for another role refuses startup, with a fixed message: the driver's error can
    // carry the host and the user (INV-12, INV-15).
    const role = await this.dispatcherPool
      .query<{ name: string }>('select current_user as name')
      .then(
        (result) => result.rows[0]?.name,
        () => undefined,
      );
    if (role !== DISPATCHER_ROLE) {
      throw new ConfigurationError([
        'DISPATCHER_DATABASE_URL: the pool is not moin_dispatcher, or the database is unreachable',
      ]);
    }
    this.#dispatcher.start();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.#dispatcher?.stop();
  }
}

@Injectable()
class WorkerResources implements OnApplicationShutdown {
  public constructor(
    @Inject(WORKER_POOL) private readonly pool: Pool,
    @Inject(JOB_QUEUES) private readonly queues: SqsQueues,
    @Inject(DISPATCHER_POOL) private readonly dispatcherPool: Pool | null,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    this.queues.close();
    await this.dispatcherPool?.end();
    await this.pool.end();
  }
}

@Module({
  // HealthModule is a singleton: this is the same ShutdownState the shutdown sequence flips.
  imports: [HealthModule],
  providers: [
    { provide: JOB_HANDLERS, useFactory: (): JobHandlerRegistry => new JobHandlerRegistry() },
    {
      provide: WORKER_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool =>
        createPool({
          connectionString: config.DATABASE_URL,
          max: Math.max(POOL_MAX_CONNECTIONS, config.JOB_CONCURRENCY + 2),
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
          idleTimeoutMillis: IDLE_TIMEOUT_MS,
          statement_timeout: STATEMENT_TIMEOUT_MS,
          idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
          application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-jobs`,
        }),
    },
    {
      provide: JOB_QUEUES,
      inject: [CONFIG],
      useFactory: async (config: Config): Promise<SqsQueues> => {
        // Presence is enforced by the configuration loader for the worker role.
        if (config.SQS_REGION === undefined || config.SQS_QUEUE_JOBS === undefined) {
          throw new ConfigurationError(['SQS_REGION and SQS_QUEUE_JOBS are required']);
        }
        return connectSqsQueues({
          region: config.SQS_REGION,
          queueName: config.SQS_QUEUE_JOBS,
          endpoint: config.SQS_ENDPOINT,
        });
      },
    },
    {
      provide: DISPATCHER_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool | null =>
        config.DISPATCHER_DATABASE_URL === undefined
          ? null
          : createPool({
              connectionString: config.DISPATCHER_DATABASE_URL,
              max: DISPATCHER_POOL_MAX,
              connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
              idleTimeoutMillis: IDLE_TIMEOUT_MS,
              statement_timeout: STATEMENT_TIMEOUT_MS,
              idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
              application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-outbox`,
            }),
    },
    JobConsumerService,
    OutboxDispatcherService,
    WorkerResources,
  ],
})
export class JobConsumerModule {}
