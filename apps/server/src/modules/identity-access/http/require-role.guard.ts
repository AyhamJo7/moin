/**
 * The role gate for sensitive actions (P06.07.02, PLAN Authorisation).
 *
 * Runs **after** `SessionMembershipGuard` (`@UseGuards(SessionMembershipGuard,
 * RequireRoleGuard)`): the session is already valid and `request.sessionContext` carries the
 * role and permissions the database read from our own membership row — never a provider claim
 * (ADR-0005). Routes declare what they need with `@Require(...)`; undecorated routes need no
 * capability beyond an active membership. All listed capabilities must hold.
 *
 * Insufficient role is a 403 `/problems/forbidden` — never a 404: past this guard the caller
 * is authenticated and in-tenant, so existence is already established. The cross-tenant 404
 * rule (P06.07.03) lives in the service layer, where a missing-or-forbidden resource is
 * indistinguishable. Every rejection is `no-store`.
 */

import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { may, type Capability } from '../domain/roles.ts';
import { currentSessionContext } from './current-context.ts';
import { CAPABILITIES_KEY } from './role.ts';

const PROBLEM_TYPE = '/problems/forbidden';
const PROBLEM_TITLE = 'Forbidden';

@Injectable()
export class RequireRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capabilities =
      this.reflector.getAllAndOverride<readonly Capability[] | undefined>(CAPABILITIES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const session = currentSessionContext(request);
    const allowed =
      session !== undefined &&
      capabilities.every((capability) => may(session.role, session.permissions, capability));
    if (!allowed) {
      this.logger.warn(
        {
          route: request.routeOptions.url,
          method: request.method,
          reason: session === undefined ? 'role_unknown' : 'role_insufficient',
        },
        'rejected a request without the required role',
      );
      void reply.header('cache-control', 'no-store');
      await reply.code(403).header('content-type', 'application/problem+json').send({
        type: PROBLEM_TYPE,
        title: PROBLEM_TITLE,
        status: 403,
      });
      return false;
    }
    return true;
  }
}
