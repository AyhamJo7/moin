/**
 * Tenant entry for guarded requests (P06.06.03, INV-01, INV-02).
 *
 * The guard admits the request with `request.sessionContext` — the organisation resolved
 * server-side from the session. This interceptor publishes that pair into an AsyncLocalStorage
 * scope for the duration of the handler: handlers open their own `withTenant(pool,
 * scope.organisationId, …)` around their queries (see `withRequestTenant`), and the organisation
 * id they pass is the one the guard resolved, never a caller claim. No database client is held
 * across `next.handle()` here; each `withTenant` call checks out its own pooled connection and
 * sets `app.current_org` transaction-locally on it. A request without a session context fails
 * closed: without it there is no organisation to enter, and entering none would read an empty
 * table while pretending to serve one.
 *
 * Every response through this interceptor carries `Cache-Control: private, no-store`: any body
 * resolved under a guard is per-tenant from a cookie-authenticated request — success or error —
 * so no shared cache may store it (the guard's own 401s and 503s already send `no-store`).
 */

import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Observable, defer, firstValueFrom } from 'rxjs';
import type { Logger } from '@moin/observability';
import { type TenantScope, runInTenantScope } from '../../platform/tenant-scope.ts';
import { LOGGER } from '../../../observability/logger.module.ts';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const session = request.sessionContext;
    if (session === undefined) {
      this.logger.error(
        { route: request.routeOptions.url, reason: 'missing-session-context' },
        'guarded request reached the tenant interceptor without a session',
      );
      throw new InternalServerErrorException();
    }
    const scope: TenantScope = {
      organisationId: session.organisationId,
      actorId: session.userId,
      role: session.role,
      permissions: session.permissions,
    };
    // Set before delegating so error responses carry it too: any body resolved under a
    // guard is per-tenant from a cookie-authenticated request, success or error.
    void reply.header('cache-control', 'private, no-store');
    return defer(() => runInTenantScope(scope, () => firstValueFrom(next.handle())));
  }
}
