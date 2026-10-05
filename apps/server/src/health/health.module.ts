import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { IDENTITY_POOL_ASSERTION, postgresReadiness, type ReadinessCheck } from '@moin/db';
import { HealthController } from './health.controller.ts';
import { READINESS_CHECKS, SHUTDOWN_STATE } from './health.tokens.ts';
import { ShutdownState } from './shutdown-state.ts';
import { CONFIG } from '../config/config.module.ts';
import type { Config } from '../config/env.ts';

/**
 * Closes every readiness probe when the application shuts down.
 *
 * Without this, `app.close()` returns with the probe's Postgres sockets still open and the
 * process only dies because `process.exit` follows. That is fine until the day it does not: an
 * integration test that builds the Nest testing module leaks a pool and hangs vitest, and a
 * shutdown path that relies on `process.exit` cannot honour a graceful drain.
 */
@Injectable()
export class ReadinessLifecycle implements OnApplicationShutdown {
  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  async onApplicationShutdown(): Promise<void> {
    // allSettled: one probe failing to close must not prevent the others from being released.
    await Promise.allSettled(this.checks.map((check) => check.close()));
  }
}

/**
 * Readiness checks are assembled per role rather than globally: `main-migrate` is a one-shot
 * process with nothing to be ready for. Today every long-running role depends on Postgres;
 * Valkey, SQS and S3 probes join this list in P08 and P05 as the roles start depending on them.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_CHECKS,
      inject: [CONFIG],
      useFactory: (config: Config): readonly ReadinessCheck[] => [
        postgresReadiness({ connectionString: config.DATABASE_URL }),
        // The api's identity pool, when it has one: ready only if it really is moin_identity and
        // moin_app really cannot execute the session functions (P06.06, ADR-0003).
        ...(config.IDENTITY_DATABASE_URL === undefined
          ? []
          : [
              postgresReadiness({
                connectionString: config.IDENTITY_DATABASE_URL,
                name: 'postgres-identity',
                assertion: IDENTITY_POOL_ASSERTION,
              }),
            ]),
      ],
    },
    { provide: SHUTDOWN_STATE, useClass: ShutdownState },
    ReadinessLifecycle,
  ],
  exports: [SHUTDOWN_STATE],
})
export class HealthModule {}
