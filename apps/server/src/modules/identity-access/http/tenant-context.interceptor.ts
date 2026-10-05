/**
 * Tenant entry for guarded requests (P06.06.03, INV-01, INV-02).
 *
 * The guard admits the request with `request.sessionContext` — the organisation resolved
 * server-side from the session. This interceptor runs the handler inside
 * `withTenant(appPool, organisationId, …, { actorId: userId })`, so every tenant row the handler
 * touches is filtered by the database policy for exactly that organisation, and the actor is the
 * signed-in user, never a caller claim. A request without a session context fails closed: without
 * it there is no organisation to enter, and entering none would read an empty table while
 * pretending to serve one.
 *
 * Implemented as an `AsyncLocalStorage` carrier rather than by wrapping the handler call: a Nest
 * interceptor cannot hold a `pg` transaction across `next.handle()` without taking ownership of
 * the connection lifecycle, so the tenant setting is established on a dedicated client for the
 * duration of the request and the handler runs inside that scope.
 */

import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type Observable, defer, firstValueFrom } from 'rxjs';
import type { Logger } from '@moin/observability';
import { type TenantScope, runInTenantScope } from '../../platform/tenant-scope.ts';
import { LOGGER } from '../../../observability/logger.module.ts';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
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
    };
    return defer(() => runInTenantScope(scope, () => firstValueFrom(next.handle())));
  }
}
