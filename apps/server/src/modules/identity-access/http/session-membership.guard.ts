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
import { ABSOLUTE_TIMEOUT_MS, CSRF_COOKIE, SESSION_COOKIE } from '../domain/session-policy.ts';
import {
  type ContextFailure,
  RequestContextService,
} from '../application/request-context.service.ts';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { REQUEST_CONTEXTS } from '../identity-access.tokens.ts';
import { readCookie, serializeCookie } from './cookies.ts';
import {
  CSRF_HEADER,
  deriveCsrfToken,
  firstHeader,
  requiresCsrfProtection,
  verifyCsrf,
} from './csrf.ts';

const PROBLEM_TYPE = '/problems/unauthenticated';
const MS_PER_SECOND = 1000;
const PROBLEM_TITLE = 'Authentication is required';

function resolveMode(request: FastifyRequest): 'read' | 'mutate' {
  // GET and HEAD are safe and idempotent; everything else resolves fresh.
  return request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'mutate';
}

@Injectable()
export class SessionMembershipGuard implements CanActivate {
  constructor(
    @Inject(REQUEST_CONTEXTS) private readonly contexts: RequestContextService | null,
    @Inject(CONFIG) private readonly config: Config,
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
      this.logger.error(
        { route: request.routeOptions.url, method: request.method, reason: 'identity-unavailable' },
        'guarded request without a request-context service',
      );
      await this.unavailable(request, reply);
      return false;
    }
    // G07 L2: the CSRF verdict comes before the session lookup, so a forged request is refused
    // without taking the session's locks or sliding its idle expiry. A dead session with a
    // well-formed proof still answers 401 below.
    if (requiresCsrfProtection(request.method)) {
      const expectedOrigin = this.config.APP_ORIGIN;
      // Unreachable when the api role started, because the loader requires APP_ORIGIN for it.
      // Kept because "unreachable" is a claim about another file (same pattern as
      // TwilioSignatureGuard's config-missing branch): without an origin to compare against,
      // every mutation fails closed.
      if (expectedOrigin === undefined) {
        this.logger.error(
          {
            route: request.routeOptions.url,
            method: request.method,
            reason: 'csrf-origin-missing',
          },
          'rejected a mutation without a configured origin',
        );
        void reply.header('cache-control', 'no-store');
        await reply.code(503).header('content-type', 'application/problem+json').send({
          type: '/problems/csrf-unavailable',
          title: 'CSRF protection is unavailable',
          status: 503,
        });
        return false;
      }
      const verdict = verifyCsrf({
        method: request.method,
        origin: request.headers.origin,
        token: firstHeader(request.headers[CSRF_HEADER]),
        cookie: readCookie(request.headers.cookie, CSRF_COOKIE),
        sessionToken: presented,
        fetchSite: request.headers['sec-fetch-site'],
        referer: request.headers.referer,
        expectedOrigin,
      });
      if (!verdict.ok) {
        this.logger.warn(
          { route: request.routeOptions.url, method: request.method, reason: verdict.reason },
          'rejected a state-changing request without CSRF proof',
        );
        void reply.header('cache-control', 'no-store');
        await reply.code(403).header('content-type', 'application/problem+json').send({
          type: '/problems/csrf-required',
          title: 'CSRF proof is required',
          status: 403,
        });
        return false;
      }
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
    // A session opened before the session-bound token (#266) holds a CSRF cookie that is not
    // derived from it, so every mutation would answer 403 until the next sign-in. A safe request
    // with a live session re-issues the derived token, the value sign-in sets: the page's next
    // poll repairs it. Never on a mutation, whose proof was judged above.
    if (!requiresCsrfProtection(request.method)) {
      const token = deriveCsrfToken(presented);
      if (readCookie(request.headers.cookie, CSRF_COOKIE) !== token) {
        void reply.header(
          'set-cookie',
          serializeCookie(CSRF_COOKIE, token, ABSOLUTE_TIMEOUT_MS / MS_PER_SECOND),
        );
      }
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
    reason: ContextFailure,
  ): Promise<void> {
    this.reject(request, reason);
    void reply.header('cache-control', 'no-store');
    await reply
      .code(401)
      .header('content-type', 'application/problem+json')
      .send({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 401 });
  }

  private reject(request: FastifyRequest, reason: ContextFailure): void {
    this.logger.warn(
      { route: request.routeOptions.url, method: request.method, reason },
      'rejected a request without a usable session and membership',
    );
  }
}
