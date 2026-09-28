import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ReadinessCheck, ReadinessResult } from '@moin/db';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const SERVER_ROLE = Symbol('SERVER_ROLE');

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * Liveness and readiness (P02.03.05).
 *
 * The two answer different questions and must not be conflated, because the orchestrator reacts
 * differently to each. **Liveness** asks "is this process wedged?" — a failing liveness probe
 * gets the container killed. It therefore checks nothing external: if it called the database, a
 * database blip would restart every container at once and turn a recoverable incident into an
 * outage. **Readiness** asks "should this instance receive traffic right now?" — a failing
 * readiness probe removes the instance from the load balancer and leaves it running, which is the
 * correct response to a dependency being briefly unavailable.
 *
 * Both are unauthenticated, so neither returns anything an attacker could use: no versions, no
 * hostnames, no connection details, and a fixed reason vocabulary (INV-12, INV-15).
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
    @Inject(SERVER_ROLE) private readonly role: string,
  ) {}

  @Get('/healthz')
  liveness(): { status: 'ok'; role: string } {
    return { status: 'ok', role: this.role };
  }

  @Get('/readyz')
  async readiness(@Res() reply: FastifyReply): Promise<void> {
    const results: ReadinessResult[] = await Promise.all(this.checks.map((check) => check.check()));
    const ready = results.every((result) => result.ready);

    await reply.status(ready ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).send({
      status: ready ? 'ready' : 'not_ready',
      role: this.role,
      checks: results.map((result) => ({
        name: result.name,
        ready: result.ready,
        durationMs: result.durationMs,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      })),
    });
  }
}
