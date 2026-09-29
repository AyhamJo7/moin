/**
 * Is PostgreSQL actually able to serve this process right now?
 *
 * Readiness is not "the connection string parses". A pool that has exhausted its connections, a
 * database in recovery, and a security group that silently drops packets all present as a healthy
 * process that cannot do any work. So the check issues a real query with a short deadline and
 * reports the outcome without the connection string.
 *
 * The pool lives here, in `@moin/db`, because it is the one package allowed to hold a raw handle
 * (`moin/no-direct-db-access`). The tenant wrapper that every business query must go through is
 * P06.03; this is deliberately the narrowest possible thing that answers the readiness question.
 */

import { createPool } from './pool.ts';

export interface ReadinessResult {
  readonly name: string;
  readonly ready: boolean;
  readonly durationMs: number;
  /** A short, non-sensitive reason. Never the connection string or the driver's raw message. */
  readonly reason?: string;
}

export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<ReadinessResult>;
  /**
   * Release whatever the check holds.
   *
   * Part of the interface, not an extra on one implementation: every probe added later (Valkey,
   * SQS, S3) will hold a connection or a client, and an interface without a close seam guarantees
   * each of them leaks. It also means a graceful shutdown can genuinely release connections
   * rather than relying on `process.exit` to do it.
   */
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * How long a readiness answer stays good.
 *
 * `/readyz` is unauthenticated and issues a real query, so without a cache a few hundred
 * concurrent requests queue on the probe's single connection, every one of them times out, every
 * task reports not-ready at once, and the load balancer drains the whole service — a full outage
 * from an endpoint that needs no credentials. One second is short enough that a genuine
 * dependency failure is still noticed within one orchestrator probe interval.
 */
const DEFAULT_CACHE_TTL_MS = 1_000;

export interface PostgresReadinessOptions {
  readonly connectionString: string;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
}

/**
 * A readiness check over its own tiny pool (max one connection).
 *
 * It is deliberately separate from the application pool: a readiness probe that competes for the
 * application's connections turns a load spike into a failed health check and then into a
 * restart loop, which is how a slow system becomes an outage.
 */
export function postgresReadiness(options: PostgresReadinessOptions): ReadinessCheck {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The driver gets the full budget and the outer race gets a little more, so a real driver error
  // (connection refused, authentication failed, database starting up) wins the race and reaches
  // `classify`. With both deadlines equal the generic timeout won every time and every specific
  // reason below was unreachable — which is how a probe ends up reporting "timed out" when what
  // it actually found was a wrong password.
  const outerTimeoutMs = timeoutMs + 250;
  const pool = createPool({
    connectionString: options.connectionString,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    idleTimeoutMillis: 10_000,
    application_name: 'moin-readiness',
  });

  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let cached: { at: number; result: ReadinessResult } | undefined;
  let inFlight: Promise<ReadinessResult> | undefined;

  async function probe(): Promise<ReadinessResult> {
    const started = performance.now();
    try {
      await withTimeout(pool.query('select 1'), outerTimeoutMs);
      return {
        name: 'postgres',
        ready: true,
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        name: 'postgres',
        ready: false,
        durationMs: Math.round(performance.now() - started),
        reason: classify(error),
      };
    }
  }

  return {
    name: 'postgres',

    /**
     * Single-flight, plus a short cache.
     *
     * `/readyz` is unauthenticated and issues a real query on a one-connection pool. Without
     * this, a few hundred concurrent requests queue on that connection, every one of them
     * exceeds the deadline, every task reports not-ready at once and the load balancer drains
     * the entire service — a full outage caused by an endpoint that needs no credentials. One
     * cheap HTTP request must not buy one database round trip.
     */
    async check(): Promise<ReadinessResult> {
      const fresh = cached;
      if (fresh !== undefined && Date.now() - fresh.at < cacheTtlMs) {
        return fresh.result;
      }
      inFlight ??= probe()
        .then((result) => {
          cached = { at: Date.now(), result };
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
    async close(): Promise<void> {
      cached = undefined;
      await pool.end();
    },
  };
}

/**
 * Map a driver failure onto a small, fixed vocabulary.
 *
 * The driver's own message can embed the host, the user and occasionally the connection string,
 * and `/readyz` is an unauthenticated endpoint — so nothing from the error text is passed
 * through (INV-12, INV-15).
 */
/** `pg` and Node's socket errors both carry a string `code`; anything else has none. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function classify(error: unknown): string {
  switch (errorCode(error)) {
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ENOTFOUND':
      return 'host not resolvable';
    case 'ETIMEDOUT':
      return 'connection timed out';
    case '28P01':
      return 'authentication failed';
    case '3D000':
      return 'database does not exist';
    case '57P03':
      return 'database is starting up';
    case undefined:
    default:
      return error instanceof Error && error.message === 'timeout' ? 'timed out' : 'unavailable';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('query failed'));
      },
    );
  });
}
