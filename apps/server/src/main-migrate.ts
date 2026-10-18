import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { migrate } from '@moin/db/migrate';
import { createLogger } from '@moin/observability';
import { ConfigurationError, loadConfig } from './config/env.ts';
import { runMigrations } from './migrate-run.ts';
import { MigrateRootModule } from './roots/migrate-root.module.ts';

/**
 * The one-shot migration runner.
 *
 * It creates an application context rather than an HTTP server — there is nothing to serve — runs
 * the reviewed SQL migrations (`packages/db`) and exits with a meaningful code, because that exit
 * code is what a deployment gates on. `DATABASE_URL` must be the migration role's connection: DDL
 * is not something the application role may do (ADR-0003). A failed migration exits 1.
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
    return await runMigrations(config.DATABASE_URL, migrate, logger);
  } finally {
    await context.close();
  }
}

process.exitCode = await main();
