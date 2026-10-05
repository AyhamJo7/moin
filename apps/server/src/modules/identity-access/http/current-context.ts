import type { FastifyRequest } from 'fastify';
import type { SessionContext } from '../application/request-context.service.ts';

/**
 * Where the guard puts the resolved organisation, so the interceptor and handlers read it without
 * re-resolving. Set only on requests the `SessionMembershipGuard` admitted; absent everywhere else.
 */
declare module 'fastify' {
  interface FastifyRequest {
    sessionContext?: SessionContext | undefined;
  }
}

export function currentSessionContext(request: FastifyRequest): SessionContext | undefined {
  return request.sessionContext;
}
