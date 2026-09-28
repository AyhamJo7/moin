import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@moin/observability';
import { ConfigurationError, loadConfig } from './config/env.ts';
import { MigrateRootModule } from './roots/migrate-root.module.ts';

/**
 * The one-shot migration runner.
 *
 * It creates an application context rather than an HTTP server — there is nothing to serve — runs
 * to completion and exits with a meaningful code, because that exit code is what a deployment
 * gates on. The migrations themselves arrive with `packages/db` in P06; until then this proves
 * the role boots, resolves its configuration and exits cleanly rather than hanging a deploy.
 */
async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(
      `${error instanceof ConfigurationError ? error.message : String(error)}\n`,
    );
    return 1;
  }

  if (config.SERVER_ROLE !== 'migrate') {
    process.stderr.write(
      `SERVER_ROLE is "${config.SERVER_ROLE}" but this entrypoint is the "migrate" role.\n`,
    );
    return 1;
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    service: config.SERVICE_NAME,
    role: 'migrate',
    env: config.NODE_ENV,
    pretty: config.LOG_PRETTY,
  });

  const context = await NestFactory.createApplicationContext(MigrateRootModule, { logger: false });
  try {
    logger.info({ outcome: 'no migrations to apply', count: 0 }, 'migration run complete');
    return 0;
  } finally {
    await context.close();
  }
}

process.exitCode = await main();
