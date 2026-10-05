/**
 * The step-up gate for sensitive actions (P06.06.04, PLAN Security Architecture).
 *
 * Runs **after** `SessionMembershipGuard` (`@UseGuards(SessionMembershipGuard,
 * RequireStepUpGuard)`): the session is already valid and `request.sessionContext` carries the
 * step-up stamp the database returned. Missing or older than 15 minutes is a 403
 * `/problems/step-up-required` — not a 401, so clients know to re-verify rather than re-login.
 * Every rejection is `no-store`. A thrown transport error is a 503, never a 403: an outage must
 * not read as stale proof to clients that would otherwise not retry or alert.
 *
 * Sensitive actions never serve the 30 s GET cache: every check resolves fresh, and the service
 * invalidates the entry so the next read re-resolves too.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import { CONTEXT_CLOCK, REQUEST_CONTEXTS } from '../identity-access.tokens.ts';
import { STEP_UP_WINDOW_MS } from '../domain/session-policy.ts';
import { digestOf } from '../domain/secret-values.ts';
import { SESSION_COOKIE } from '../domain/session-policy.ts';
import type { RequestContextService } from '../application/request-context.service.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { readCookie } from './cookies.ts';

const PROBLEM_TYPE = '/problems/step-up-required';
const PROBLEM_TITLE = 'Step-up verification is required';

@Injectable()
export class RequireStepUpGuard implements CanActivate {
  constructor(
    @Inject(REQUEST_CONTEXTS) private readonly contexts: RequestContextService | null,
    @Inject(CONTEXT_CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const presented = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (presented === undefined || this.contexts === null) {
      await this.problem(request, reply, 'step_up_unknown');
      return false;
    }
    let outcome: Awaited<ReturnType<RequestContextService['resolve']>>;
    try {
      // Always fresh: sensitive actions never serve the read cache, whatever the method.
      outcome = await this.contexts.resolve(digestOf(presented), 'mutate');
    } catch {
      this.logger.error(
        { route: request.routeOptions.url, method: request.method, reason: 'identity-unavailable' },
        'step-up lookup failed',
      );
      await this.unavailable(request, reply);
      return false;
    }
    if ('failure' in outcome) {
      await this.problem(request, reply, 'step_up_unknown');
      return false;
    }
    const stepUpAt = outcome.context.stepUpAt;
    if (stepUpAt === null || this.clock.now().getTime() - stepUpAt.getTime() > STEP_UP_WINDOW_MS) {
      await this.problem(request, reply, stepUpAt === null ? 'step_up_unknown' : 'step_up_stale');
      return false;
    }
    return true;
  }

  private async unavailable(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    void reply.header('cache-control', 'no-store');
    await reply.code(503).header('content-type', 'application/problem+json').send({
      type: '/problems/identity-unavailable',
      title: 'Identity is unavailable',
      status: 503,
    });
  }

  private async problem(
    request: FastifyRequest,
    reply: FastifyReply,
    reason: 'step_up_unknown' | 'step_up_stale',
  ): Promise<void> {
    this.logger.warn(
      { route: request.routeOptions.url, method: request.method, reason },
      'rejected a request without fresh step-up verification',
    );
    void reply.header('cache-control', 'no-store');
    await reply
      .code(403)
      .header('content-type', 'application/problem+json')
      .send({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 403 });
  }
}
