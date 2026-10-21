/**
 * Wires the job consumer into the worker role (P08.05.01).
 *
 * The worker holds a `moin_app` pool (NOBYPASSRLS, owning no tables) that is only ever used inside
 * `withTenant`, via `executeJob`. The queue connection is resolved at startup, so a missing queue
 * or a mistyped name refuses to start (`ConfigurationError`) instead of polling nothing.
 *
 * The registry is empty in this slice: no production job type has a handler yet (the outbox
 * dispatcher and the post-call finaliser arrive with their own slices). A delivery for a type
 * without a handler is recorded as a transient `handler-unavailable` failure and follows the
 * retry schedule to the DLQ; it is never acknowledged as processed.
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
import type { Logger } from '@moin/observability';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, type Config } from '../../config/env.ts';
import { HealthModule } from '../../health/health.module.ts';
import { SHUTDOWN_STATE } from '../../health/health.tokens.ts';
import type { ShutdownState } from '../../health/shutdown-state.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { JobConsumer, JobHandlerRegistry } from './job-consumer.ts';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');
const WORKER_POOL = Symbol('WORKER_POOL');
const JOB_QUEUES = Symbol('JOB_QUEUES');

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
class WorkerResources implements OnApplicationShutdown {
  public constructor(
    @Inject(WORKER_POOL) private readonly pool: Pool,
    @Inject(JOB_QUEUES) private readonly queues: SqsQueues,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    this.queues.close();
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
    JobConsumerService,
    WorkerResources,
  ],
})
export class JobConsumerModule {}
