/**
 * The per-request session + membership gate (P06.06.03, FS-16, INV-02).
 *
 * Applied per controller with `@UseGuards(SessionMembershipGuard)`; health and `/api/auth/*` stay
 * public. A request that reaches a handler past this guard carries `request.sessionContext` — the
 * organisation resolved server-side from the session — and everything downstream (the tenant
 * interceptor, the handler) depends on that being true.
 *
 * It fails closed with an RFC 9457 401 that names the coarse outcome and nothing else: whether the
 * cookie was absent, the session expired or revoked, the user inactive, the membership gone, or
 * several organisations matched, is a reason code in the log, never in the response. Every 401 is
 * `no-store`: a cached rejection would turn a later-valid session into a mystery. A thrown
 * transport error — timeout, refusal, pool exhaustion — is a 503, never a 401: an outage must not
 * read as bad credentials to clients that would otherwise not retry or alert.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { digestOf } from '../domain/secret-values.ts';
import { SESSION_COOKIE } from '../domain/session-policy.ts';
import {
  type ContextFailure,
  RequestContextService,
} from '../application/request-context.service.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { REQUEST_CONTEXTS } from '../identity-access.tokens.ts';
import { readCookie } from './cookies.ts';

const PROBLEM_TYPE = '/problems/unauthenticated';
const PROBLEM_TITLE = 'Authentication is required';

function resolveMode(request: FastifyRequest): 'read' | 'mutate' {
  // GET and HEAD are safe and idempotent; everything else resolves fresh.
  return request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'mutate';
}

@Injectable()
export class SessionMembershipGuard implements CanActivate {
  constructor(
    @Inject(REQUEST_CONTEXTS) private readonly contexts: RequestContextService | null,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const presented = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (presented === undefined) {
      await this.problem(request, reply, 'no_session');
      return false;
    }
    if (this.contexts === null) {
      await this.problem(request, reply, 'unavailable');
      return false;
    }
    let outcome: Awaited<ReturnType<RequestContextService['resolve']>>;
    try {
      outcome = await this.contexts.resolve(digestOf(presented), resolveMode(request));
    } catch {
      this.logger.error(
        { route: request.routeOptions.url, method: request.method, reason: 'identity-unavailable' },
        'request-context lookup failed',
      );
      await this.unavailable(request, reply);
      return false;
    }
    if ('failure' in outcome) {
      await this.problem(request, reply, outcome.failure);
      return false;
    }
    request.sessionContext = outcome.context;
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
    reason: ContextFailure | 'unavailable',
  ): Promise<void> {
    this.reject(request, reason);
    void reply.header('cache-control', 'no-store');
    await reply
      .code(401)
      .header('content-type', 'application/problem+json')
      .send({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 401 });
  }

  private reject(request: FastifyRequest, reason: ContextFailure | 'unavailable'): void {
    this.logger.warn(
      { route: request.routeOptions.url, method: request.method, reason },
      'rejected a request without a usable session and membership',
    );
  }
}
