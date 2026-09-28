import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ReadinessCheck, ReadinessResult } from '@moin/db';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../observability/logger.module.ts';
import { READINESS_CHECKS, SHUTDOWN_STATE } from './health.tokens.ts';
import type { ShutdownState } from './shutdown-state.ts';

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * Liveness and readiness (P02.03.05).
 *
 * The two answer different questions and must not be conflated, because the orchestrator reacts
 * differently to each. **Liveness** asks "is this process wedged?" — a failing liveness probe gets
 * the container killed. It therefore checks nothing external: if it called the database, a
 * database blip would restart every container at once and turn a recoverable incident into an
 * outage. **Readiness** asks "should this instance receive traffic right now?" — a failing
 * readiness probe removes the instance from the load balancer and leaves it running, which is the
 * correct response to a dependency being briefly unavailable, and to this instance shutting down.
 *
 * Both are unauthenticated, so the response body is deliberately thin. An earlier version
 * returned the role, each check's duration and a reason such as `authentication failed` — which
 * together fingerprint the host, give a timing oracle on the internal database, and announce a
 * credential-rotation window. The detail now goes to the log, where it is redacted and requires
 * access to read (INV-12, INV-15).
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
    @Inject(SHUTDOWN_STATE) private readonly shutdown: ShutdownState,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Liveness stays 200 while the process is shutting down. Returning 503 here would make the
   * orchestrator kill the container instead of letting it drain, which is the opposite of what a
   * graceful shutdown needs.
   */
  @Get('/healthz')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('/readyz')
  async readiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<{
    status: 'ready' | 'not_ready';
    checks: { name: string; ready: boolean }[];
  }> {
    // During drain this instance must leave the load balancer before the listener closes,
    // otherwise every rolling deploy produces a burst of connection failures (INV-19).
    if (this.shutdown.isShuttingDown()) {
      reply.status(HTTP_SERVICE_UNAVAILABLE);
      return { status: 'not_ready', checks: [] };
    }

    // allSettled, not all: a probe that throws must still produce a structured not-ready, not a
    // 500 with a framework error body that the orchestrator cannot interpret.
    const settled = await Promise.allSettled(this.checks.map((check) => check.check()));
    const results: ReadinessResult[] = settled.map((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : {
            name: this.checks[index]?.name ?? 'unknown',
            ready: false,
            durationMs: 0,
            reason: 'check failed',
          },
    );

    const ready = results.every((result) => result.ready);
    if (!ready) {
      this.logger.warn(
        {
          outcome: 'not ready',
          count: results.filter((r) => !r.ready).length,
          checks: results.map((r) => ({ name: r.name, ready: r.ready, reason: r.reason })),
        },
        'readiness check failed',
      );
    }

    reply.status(ready ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks: results.map((result) => ({ name: result.name, ready: result.ready })),
    };
  }
}
