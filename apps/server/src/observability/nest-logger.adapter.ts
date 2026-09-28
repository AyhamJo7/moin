import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@moin/observability';

/**
 * Routes NestJS's own logging through the redacting Pino logger.
 *
 * The server previously started with `{ logger: false }`, which disables Nest's logger globally
 * — including the `ExceptionsHandler` that reports unhandled exceptions. An unhandled 500 in
 * production therefore produced no log line at all: the client got
 * `{"statusCode":500,"message":"Internal server error"}` and operations got silence.
 *
 * `{ logger: false }` was not wrong in spirit — Nest's default logger writes unstructured,
 * unredacted text to stdout. The answer is to replace it rather than switch it off.
 */
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: unknown): void {
    this.logger.info({ event: asContext(context) }, asMessage(message));
  }

  error(message: unknown, stackOrContext?: unknown, context?: unknown): void {
    // Nest passes a stack string as the second argument. It is not logged here: a stack Nest
    // produced can embed a message that carries personal data, and the structured `err` path in
    // the redactor is the sanctioned way to record one.
    this.logger.error(
      { event: asContext(context ?? stackOrContext), outcome: 'nest error' },
      asMessage(message),
    );
  }

  warn(message: unknown, context?: unknown): void {
    this.logger.warn({ event: asContext(context) }, asMessage(message));
  }

  debug(message: unknown, context?: unknown): void {
    this.logger.debug({ event: asContext(context) }, asMessage(message));
  }

  verbose(message: unknown, context?: unknown): void {
    this.logger.trace({ event: asContext(context) }, asMessage(message));
  }

  fatal(message: unknown, context?: unknown): void {
    this.logger.fatal({ event: asContext(context) }, asMessage(message));
  }
}

/**
 * Nest's messages are framework strings ("Mapped {/healthz, GET} route"), not user data. Anything
 * that is not a string is replaced rather than stringified, because an object here is usually an
 * error or a payload and `String(value)` on either is how a message ends up in a log line.
 */
function asMessage(message: unknown): string {
  return typeof message === 'string' ? message : 'nest log entry';
}

function asContext(context: unknown): string | undefined {
  return typeof context === 'string' ? context : undefined;
}
