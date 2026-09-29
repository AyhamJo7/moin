import { Global, Module } from '@nestjs/common';
import { createLogger, type Logger } from '@moin/observability';
import { CONFIG } from '../config/config.module.ts';
import type { Config } from '../config/env.ts';

export const LOGGER = Symbol('LOGGER');

/**
 * The application's single logger, available to every module.
 *
 * Before this existed, `bootstrap.ts` built a logger in a local variable and nothing else could
 * reach it. The predictable outcome is each module calling `createLogger()` itself — duplicate
 * instances with drifting base fields — or reaching for `console.*` and fighting the lint rule
 * that exists to keep personal data out of logs (INV-12).
 */
@Global()
@Module({
  providers: [
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: Config): Logger =>
        createLogger({
          level: config.LOG_LEVEL,
          service: config.SERVICE_NAME,
          role: config.SERVER_ROLE,
          env: config.NODE_ENV,
          ...(config.APP_VERSION === undefined ? {} : { version: config.APP_VERSION }),
          pretty: config.LOG_PRETTY,
        }),
    },
  ],
  exports: [LOGGER],
})
export class LoggerModule {}
