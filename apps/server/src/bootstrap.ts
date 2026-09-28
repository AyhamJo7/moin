/**
 * Shared boot path for the long-running HTTP roles.
 *
 * Three things here are not incidental:
 *
 * **Configuration is validated before Nest is constructed.** A bad `DATABASE_URL` should fail the
 * deploy, not surface on the first request that touches the pool.
 *
 * **The listener binds `0.0.0.0`.** Inside a container, binding `localhost` makes the service
 * reachable only from inside its own network namespace, which presents as a health check that
 * times out for no visible reason.
 *
 * **Shutdown is graceful and bounded.** On SIGTERM the listener stops accepting, in-flight work
 * gets `SHUTDOWN_GRACE_MS` to finish, and then the process exits regardless. Without the bound, a
 * single stuck request holds the container open until the orchestrator SIGKILLs it, which drops
 * every other in-flight request on that instance (INV-19).
 */

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger, type Logger } from '@moin/observability';
import { loadConfig, describeConfig, ConfigurationError, type Config } from './config/env.ts';

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export interface BootstrapOptions {
  readonly rootModule: unknown;
  readonly role: Config['SERVER_ROLE'];
}

export async function bootstrapHttpRole(options: BootstrapOptions): Promise<void> {
  const config = loadConfigOrExit();

  if (config.SERVER_ROLE !== options.role) {
    process.stderr.write(
      `SERVER_ROLE is "${config.SERVER_ROLE}" but this entrypoint is the "${options.role}" role. ` +
        'One image is built per release and the role is chosen by the start command (INV-17); ' +
        'starting the wrong pair would silently run the wrong module graph.\n',
    );
    process.exit(1);
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    service: config.SERVICE_NAME,
    role: config.SERVER_ROLE,
    env: config.NODE_ENV,
    ...(config.APP_VERSION === undefined ? {} : { version: config.APP_VERSION }),
    pretty: config.LOG_PRETTY,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    options.rootModule as never,
    new FastifyAdapter(),
    { logger: false },
  );
  app.enableShutdownHooks();

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ route: '/healthz', statusCode: 200 }, 'server listening');
  logger.debug({ outcome: 'configuration resolved', ...describeConfig(config) }, 'configuration');

  installShutdown(app, logger, config.SHUTDOWN_GRACE_MS);
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    // Deliberately not the logger: the logger is built *from* the configuration that just failed
    // to load, so there is nothing valid to construct it with.
    process.stderr.write(
      `${error instanceof ConfigurationError ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

function installShutdown(app: NestFastifyApplication, logger: Logger, graceMs: number): void {
  let shuttingDown = false;

  for (const signal of SIGNALS) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ reason: signal, outcome: 'shutdown started' }, 'shutting down');

      // Unref'd so the timer itself never keeps the process alive once close() has finished.
      const deadline = setTimeout(() => {
        logger.warn({ reason: 'grace period expired', durationMs: graceMs }, 'forcing exit');
        process.exit(1);
      }, graceMs);
      deadline.unref();

      app.close().then(
        () => {
          clearTimeout(deadline);
          logger.info({ outcome: 'shutdown complete' }, 'stopped');
          process.exit(0);
        },
        (error: unknown) => {
          clearTimeout(deadline);
          logger.error({ err: error, outcome: 'shutdown failed' }, 'stopped with error');
          process.exit(1);
        },
      );
    });
  }
}
