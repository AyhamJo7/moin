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
import { pino, type LogFn, type Logger, type LoggerOptions } from 'pino';
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

    // A security review of this file found two ways round the allowlist. Both are closed here,
    // and both are covered by tests that assert on the *serialised line* rather than on
    // `redactToAllowlist` in isolation — testing the redactor alone is exactly what hid them.
    hooks: {
      /**
       * `logger.error(err)` used to put `err.message` straight into `msg`.
       *
       * pino appends the message key after `formatters.log` has run, so the message never met the
       * redactor: a `pg` error reading `password authentication failed for user "moin_app"`, or a
       * connection error carrying the full DSN, was written verbatim while the `err` branch
       * dutifully replaced the same string with `[redacted]`.
       *
       * An `Error` first argument is therefore normalised into `{ err }` with a fixed message.
       * The type, the code and the call frames survive; the message does not.
       */
      logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
        const [first, second] = args;
        if (first instanceof Error) {
          const message = typeof second === 'string' ? second : 'error';
          method.call(this, { err: first }, message);
          return;
        }
        method.apply(this, args);
      },
    },

    // pino's default `err` serializer would otherwise rewrite the redacted error object and set
    // `type` from its constructor — which, after redaction has turned it into a plain object, is
    // always `"Object"`. That loses the error class, the single most useful field in an incident.
    // Redaction has already happened by this point, so the value passes through unchanged.
    serializers: { err: (value: unknown) => value },

    formatters: {
      // Applies to the root bindings. Child bindings do NOT pass through here — pino serialises
      // those once, at `child()` time, into a cached string. They are handled by `hardenChild`.
      bindings(bindings: Record<string, unknown>): Record<string, unknown> {
        return redactToAllowlist(bindings) as Record<string, unknown>;
      },

      // Called with the merged object for every line: the one place every structured field on an
      // individual log call is guaranteed to pass through.
      log(object: Record<string, unknown>): Record<string, unknown> {
        const context = storage.getStore();
        const merged = context === undefined ? object : { ...context, ...object };
        return redactToAllowlist(merged) as Record<string, unknown>;
      },
    },
  };

  if (config.pretty === true) {
    return hardenChild(
      pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } }),
    );
  }
  return hardenChild(pino(options));
}

/**
 * Make `logger.child(...)` redact its bindings, recursively.
 *
 * This is the one hole a review found in the allowlist, and it is the important one:
 * `logger.child({ requestId, organisationId, callId })` is *the* idiomatic per-request pattern in
 * NestJS, so it is the shape most future logging calls will take. pino serialises child bindings
 * once, when the child is created, into a cached string that never passes through
 * `formatters.log` — and `formatters.bindings` does not cover it either (measured, not assumed:
 * adding that formatter alone left `logger.child({ phone }).info(...)` writing the number
 * verbatim).
 *
 * The wrapper is deliberately not a lint rule plus a `childLogger()` helper. A lint rule protects
 * the code that is written after someone reads the rule; overriding the method makes the safe
 * path the only path, including for code inside a dependency that holds our logger.
 */
function hardenChild(logger: Logger): Logger {
  // Capture pino's own implementation once, before anything is overridden.
  //
  // pino builds a child with `Object.create(parent)`, so a child *inherits* the parent's
  // properties — including this override. Reading `logger.child` on a child therefore resolves to
  // the parent's wrapper, which is bound to the parent, and a grandchild silently loses every
  // binding its parent added. That is what the first version of this function did, and the test
  // below is the one that caught it.
  return applyHardening(logger, pristineChild(logger));
}

/** pino's own `child`, typed as pino declares it rather than re-described here. */
type ChildFn = Logger['child'];
type ChildBindings = Parameters<ChildFn>[0];
type ChildOptions = Parameters<ChildFn>[1];

/** pino's real `child`, found by walking past any wrapper an ancestor installed. */
function pristineChild(logger: Logger): ChildFn {
  let current: object | null = logger;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'child');
    // An own `child` that is not marked as ours is pino's implementation on its prototype.
    if (descriptor !== undefined && Reflect.get(current, HARDENED) !== true) {
      return descriptor.value as ChildFn;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return logger.child.bind(logger);
}

const HARDENED = Symbol('moin.hardenedChild');

function applyHardening(logger: Logger, pristine: ChildFn): Logger {
  Object.defineProperty(logger, HARDENED, { value: true, enumerable: false, configurable: true });
  Object.defineProperty(logger, 'child', {
    value: (bindings: ChildBindings, options?: ChildOptions): Logger => {
      const redacted = redactToAllowlist(bindings) as ChildBindings;
      // `.call(logger, …)` rather than a bound copy: `this` must be the logger the caller used,
      // so the child inherits that logger's accumulated bindings and not an ancestor's.
      // pino types `child` as returning `Logger<ChildCustomLevels, boolean>`, which does not
      // narrow to the default `Logger` under `exactOptionalPropertyTypes`. The runtime value is
      // the same object; only the generic parameters differ.
      const child = pristine.call(logger, redacted, options) as unknown as Logger;
      return applyHardening(child, pristine);
    },
    configurable: true,
    writable: true,
  });
  return logger;
}

export type { Logger };
