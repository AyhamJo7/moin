import { Global, Module } from '@nestjs/common';
import { createLogger, type Logger } from '@moin/observability';
import { tenantLogFields } from '@moin/db';
import { CONFIG } from '../config/config.module.ts';
import type { Config } from '../config/env.ts';

export const LOGGER = Symbol('LOGGER');

/** The application logger for `config`. Also used by `bootstrap` while the module graph is built. */
export function buildLogger(config: Config): Logger {
  return createLogger({
    level: config.LOG_LEVEL,
    service: config.SERVICE_NAME,
    role: config.SERVER_ROLE,
    env: config.NODE_ENV,
    ...(config.APP_VERSION === undefined ? {} : { version: config.APP_VERSION }),
    pretty: config.LOG_PRETTY,
    // Every line inside a tenant transaction carries which tenant it was for (P06.03.06).
    // An organisation id names a business rather than a person, which is why the redaction
    // allowlist permits it; outside a transaction this returns nothing rather than throwing,
    // because the paths with no tenant are exactly the ones that must keep logging.
    context: tenantLogFields,
  });
}

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
      useFactory: buildLogger,
    },
  ],
  exports: [LOGGER],
})
export class LoggerModule {}
