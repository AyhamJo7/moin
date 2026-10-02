/**
 * Shared boot path for the long-running HTTP roles.
 *
 * Most of what is here exists because of how containers are actually stopped, which is less
 * forgiving than it looks:
 *
 * **Signal handlers are installed before anything slow.** `CMD ["node", …]` makes node PID 1, and
 * the kernel does not apply default signal actions to PID 1 — an unhandled SIGTERM at PID 1 is
 * discarded. If the handler were registered after `listen()`, a SIGTERM arriving during a slow DI
 * graph or a stuck bind would be dropped and the container would hang until the orchestrator's
 * SIGKILL.
 *
 * **Only SIGTERM and SIGINT are handled.** Nest's `enableShutdownHooks()` with no arguments
 * listens on all eleven `ShutdownSignal` values, including SIGSEGV, SIGBUS, SIGFPE, SIGILL and
 * SIGABRT. Registering a JavaScript listener for those suppresses the default crash action, so a
 * native fault would try to run an async graceful shutdown from a corrupted process: no core
 * dump, no crash exit code, and a decent chance of a wedged container.
 *
 * **Shutdown drains before it closes.** SIGTERM and load-balancer deregistration are concurrent,
 * not ordered, so the listener must stay open while `/readyz` reports 503 (INV-19).
 *
 * **The listener binds `0.0.0.0`.** Binding `localhost` inside a container makes the service
 * reachable only from its own network namespace, which presents as a health check that times out
 * for no visible reason.
 */

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LoggerService, Type } from '@nestjs/common';
import type { Logger } from '@moin/observability';
import { loadConfig, describeConfig, ConfigurationError, type Config } from './config/env.ts';
import { ConfigModule } from './config/config.module.ts';
import { LOGGER, buildLogger } from './observability/logger.module.ts';
import { NestLoggerAdapter } from './observability/nest-logger.adapter.ts';
import { SHUTDOWN_STATE } from './health/health.tokens.ts';
import { registerCorrelation } from './observability/correlation.ts';
import type { ShutdownState } from './health/shutdown-state.ts';

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export interface BootstrapOptions {
  readonly rootModule: Type<unknown>;
  readonly role: Config['SERVER_ROLE'];
}

export async function bootstrapHttpRole(options: BootstrapOptions): Promise<void> {
  // Registered first, before any await: see the note about PID 1 above.
  const lifecycle = installSignalHandlers();

  const config = loadConfigOrExit();

  if (config.SERVER_ROLE !== options.role) {
    process.stderr.write(
      `SERVER_ROLE is "${config.SERVER_ROLE}" but this entrypoint is the "${options.role}" role. ` +
        'One image is built per release and the role is chosen by the start command (INV-17); ' +
        'starting the wrong pair would silently run the wrong module graph.\n',
    );
    process.exit(1);
  }

  // Resolved once here; the root modules reuse it via ConfigModule.forFeature().
  ConfigModule.forRoot(config);

  const app = await createOrExit(options.rootModule, new NestLoggerAdapter(buildLogger(config)));

  const logger = app.get<Logger>(LOGGER);
  // Replace Nest's logger rather than disabling it: with `{ logger: false }` an unhandled 500
  // produces no log line at all, because Nest's ExceptionsHandler reports through it.
  app.useLogger(new NestLoggerAdapter(logger));

  installCrashHandlers(logger);

  registerCorrelation(app.getHttpAdapter().getInstance());

  const shutdownState = app.get<ShutdownState>(SHUTDOWN_STATE);
  lifecycle.attach({ app, logger, shutdownState, config });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ outcome: 'listening', route: '/healthz' }, 'server listening');
  logger.debug({ outcome: 'configuration resolved', ...describeConfig(config) }, 'configuration');
}

/**
 * A module may refuse to build because the environment cannot run it safely — sign-in without
 * provider-token custody is the first (P06.06.01). That refusal is a `ConfigurationError` and must
 * leave the process the way `loadConfigOrExit` does: one line naming the problem, no value, exit 1.
 * Nest's default on a failed graph is to print the raw error and `abort()`, which bypasses both the
 * redacting logger and a clean exit code, so it is given the redacting logger and told to throw
 * instead, and the refusal is caught here. Anything that is not a configuration refusal still propagates as a crash.
 */
export async function createOrExit(
  rootModule: Type<unknown>,
  logger: LoggerService,
): Promise<NestFastifyApplication> {
  try {
    // The redacting logger from the first line: a failure while the graph is built is reported
    // through it, never as Nest's raw text and stack.
    return await NestFactory.create<NestFastifyApplication>(rootModule, new FastifyAdapter(), {
      logger,
      abortOnError: false,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    // Deliberately not the logger: the logger is built *from* the configuration that just failed
    // to load, so there is nothing valid to construct it with.
    process.stderr.write(
      `${error instanceof ConfigurationError ? error.message : 'configuration could not be loaded'}\n`,
    );
    process.exit(1);
  }
}

/**
 * Node's default handler for an uncaught exception writes `Error: <message>` and a stack straight
 * to stderr, which the container log driver ships onward — bypassing the redactor entirely and
 * carrying whatever the message holds, which for a driver error is often a DSN with a password
 * (INV-12, INV-15).
 */
function installCrashHandlers(logger: Logger): void {
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error, outcome: 'uncaught exception' }, 'crashing');
    flushAndExit(logger, 1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal(
      {
        err: reason instanceof Error ? reason : new Error('non-error rejection'),
        outcome: 'unhandled rejection',
      },
      'crashing',
    );
    flushAndExit(logger, 1);
  });
}

interface Attached {
  readonly app: NestFastifyApplication;
  readonly logger: Logger;
  readonly shutdownState: ShutdownState;
  readonly config: Config;
}

/**
 * Installs the signal handlers immediately and lets the application attach to them once it is
 * built. Before it attaches, a signal means "we never started serving": exit straight away.
 */
function installSignalHandlers(): { attach(attached: Attached): void } {
  let attached: Attached | undefined;
  let shuttingDown = false;

  const onSignal = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (attached === undefined) {
      process.exit(0);
    }
    void drainAndClose(attached, signal);
  };

  for (const signal of SIGNALS)
    process.on(signal, () => {
      onSignal(signal);
    });

  return {
    attach(next: Attached): void {
      attached = next;
    },
  };
}

async function drainAndClose(attached: Attached, signal: string): Promise<void> {
  const { app, logger, shutdownState, config } = attached;
  const drainMs = config.DRAIN_MS;

  logger.info({ reason: signal, outcome: 'draining', durationMs: drainMs }, 'shutting down');

  // Stop advertising readiness first and keep serving, so the load balancer removes this
  // instance before the listener goes away.
  shutdownState.beginShutdown();
  await new Promise((resolve) => setTimeout(resolve, drainMs));

  const deadline = setTimeout(() => {
    logger.warn(
      { reason: 'grace period expired', durationMs: config.SHUTDOWN_GRACE_MS },
      'forcing exit',
    );
    flushAndExit(logger, 1);
  }, config.SHUTDOWN_GRACE_MS);
  deadline.unref();

  try {
    await app.close();
    clearTimeout(deadline);
    logger.info({ outcome: 'shutdown complete' }, 'stopped');
    flushAndExit(logger, 0);
  } catch (error) {
    clearTimeout(deadline);
    logger.error({ err: error, outcome: 'shutdown failed' }, 'stopped with error');
    flushAndExit(logger, 1);
  }
}

/**
 * Container stdout is a pipe, so writes are asynchronous: calling `process.exit` straight after a
 * log call drops the buffered output — precisely the shutdown lines needed to diagnose a bad
 * deploy.
 */
function flushAndExit(logger: Logger, code: number): void {
  try {
    logger.flush();
  } catch {
    // Flushing is best effort; never let it prevent the exit.
  }
  setTimeout(() => {
    process.exit(code);
  }, 50).unref();
}
