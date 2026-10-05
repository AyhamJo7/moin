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
 * `no-store`: a cached rejection would turn a later-valid session into a mystery.
 */

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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

function isReadOnlyGet(request: FastifyRequest): boolean {
  return request.method === 'GET';
}

@Injectable()
export class SessionMembershipGuard implements CanActivate {
  constructor(
    @Inject(REQUEST_CONTEXTS) private readonly contexts: RequestContextService | null,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const presented = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (presented === undefined) {
      this.reject(request, 'no_session');
      throw new UnauthorizedException({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 401 });
    }
    if (this.contexts === null) {
      this.reject(request, 'unavailable');
      throw new UnauthorizedException({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 401 });
    }
    const outcome = await this.contexts.resolve(
      digestOf(presented),
      isReadOnlyGet(request),
    );
    if ('failure' in outcome) {
      this.reject(request, outcome.failure);
      throw new UnauthorizedException({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 401 });
    }
    request.sessionContext = outcome.context;
    return true;
  }

  private reject(request: FastifyRequest, reason: ContextFailure | 'unavailable'): void {
    this.logger.warn(
      { route: request.routeOptions.url, method: request.method, reason },
      'rejected a request without a usable session and membership',
    );
  }
}
