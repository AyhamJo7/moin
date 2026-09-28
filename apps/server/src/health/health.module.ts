import { Module } from '@nestjs/common';
import { postgresReadiness, type ReadinessCheck } from '@moin/db';
import { HealthController, READINESS_CHECKS, SERVER_ROLE } from './health.controller.ts';
import { CONFIG } from '../config/config.module.ts';
import type { Config } from '../config/env.ts';

/**
 * Readiness checks are assembled per role rather than globally: the worker has no HTTP surface to
 * be ready for in the same sense as the API, and `main-migrate` is a one-shot process. Today every
 * long-running role depends on Postgres; Valkey, SQS and S3 checks join this list in P08 and P05
 * as the roles start depending on them.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_CHECKS,
      inject: [CONFIG],
      useFactory: (config: Config): readonly ReadinessCheck[] => [
        postgresReadiness({ connectionString: config.DATABASE_URL }),
      ],
    },
    {
      provide: SERVER_ROLE,
      inject: [CONFIG],
      useFactory: (config: Config): string => config.SERVER_ROLE,
    },
  ],
})
export class HealthModule {}
