/**
 * The step-up gate for sensitive actions (P06.06.04, PLAN Security Architecture).
 *
 * Runs **after** `SessionMembershipGuard` (`@UseGuards(SessionMembershipGuard,
 * RequireStepUpGuard)`): the session is already valid and `request.sessionContext` carries the
 * freshness verdict the database judged against its own clock. Not fresh is a 403
 * `/problems/step-up-required` — not a 401, so clients know to re-verify rather than re-login.
 * Every rejection is `no-store`. A thrown transport error is a 503, never a 403: an outage must
 * not read as stale proof to clients that would otherwise not retry or alert.
 *
 * Single resolve per request (M1): the first guard already resolved this token in mutate mode
 * for anything but a cached read, and `sessionContext` carries the verdict. Re-resolving here
 * would double the family→session→user→membership locks and slide writes per request and open
 * a TOCTOU gap between the membership verdict and the stamp verdict.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { currentSessionContext } from './current-context.ts';

const PROBLEM_TYPE = '/problems/step-up-required';
const PROBLEM_TITLE = 'Step-up verification is required';

@Injectable()
export class RequireStepUpGuard implements CanActivate {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const session = currentSessionContext(request);
    if (session?.stepUpFresh !== true) {
      await this.problem(
        request,
        reply,
        session === undefined ? 'step_up_unknown' : 'step_up_stale',
      );
      return false;
    }
    return true;
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
