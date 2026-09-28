/**
 * The repository's only sanctioned log path (P02.03.04).
 *
 * Every line goes through the INV-12 allowlist before it is serialised, which is why `console.*`
 * is a lint error in production code: it writes straight to stdout and skips this module.
 *
 * Correlation identifiers travel in `AsyncLocalStorage` rather than being threaded through every
 * function signature. A request id that has to be passed by hand is a request id that is missing
 * from exactly the log line you need during an incident.
 *
 * Full telemetry — OpenTelemetry traces, metrics, exporters — arrives in P15.01. This is the
 * baseline it builds on.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type Logger, type LoggerOptions } from 'pino';
import { redactToAllowlist } from './redaction.ts';

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly organisationId?: string;
  readonly userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `context` attached to every log line it produces, at any depth. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export interface LoggerConfig {
  readonly level: string;
  readonly service: string;
  readonly role: string;
  readonly env: string;
  readonly version?: string;
  /** Pretty-print for a human terminal. Never enabled outside local development. */
  readonly pretty?: boolean;
}

export function createLogger(config: LoggerConfig): Logger {
  const base: Record<string, string> = {
    service: config.service,
    role: config.role,
    env: config.env,
  };
  if (config.version !== undefined) base['version'] = config.version;

  const options: LoggerOptions = {
    level: config.level,
    base,
    // ISO timestamps: correlating a call recording, a Twilio log and our own line by epoch
    // milliseconds during an incident is a needless tax.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // pino calls this with the merged object for every line, which is the one place every
      // structured field is guaranteed to pass through.
      log(object: Record<string, unknown>): Record<string, unknown> {
        const context = storage.getStore();
        const merged = context === undefined ? object : { ...context, ...object };
        return redactToAllowlist(merged) as Record<string, unknown>;
      },
    },
  };

  if (config.pretty === true) {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return pino(options);
}

export type { Logger };
