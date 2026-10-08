/**
 * Member queries for the invitation and lifecycle routes (P06.08, INV-01, INV-02).
 *
 * Lives in `platform/` — the one place allowed to hold the raw tenant pool — so the members
 * controller never imports the pool entry or names the pool type. The organisation id passed to
 * `withTenant` is always the guard-resolved scope's own, never a caller claim; the one
 * exception is the accept flow, which enters the invitation row's own organisation (read from
 * the row the token opened, never from the caller).
 */

import { Inject, Injectable } from '@nestjs/common';
import { type TenantClient, withTenant } from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { randomUUID } from 'node:crypto';
import { currentRequestContext } from '@moin/observability';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id every audit row of this request carries (INV-10, P06.10.03). `audit_events.correlation_id`
 * is a uuid, but an inbound `x-correlation-id` may be any safe token: a caller-supplied value is
 * used when it is a uuid, otherwise the request id (always a uuid, never caller-chosen) — so
 * every row of one request is findable by one id and a malformed header can never fail an audit
 * write.
 */
function auditCorrelationId(): string | undefined {
  // Tests build the Nest app without bootstrap's onRequest hook, so no request context exists
  // there; production always has one. Fall back to a fresh uuid (never NULL, never caller
  // input) so the audit write cannot fail for lack of correlation anywhere.
  const context = currentRequestContext();
  if (context === undefined) return randomUUID();
  return UUID.test(context.correlationId) ? context.correlationId : context.requestId;
}

@Injectable()
export class MemberQueries {
  constructor(@Inject(TENANT_POOL) private readonly dbPool: Pool | null) {}

  /** The raw pool, for handlers that open their own `withTenant` on the guard scope. */
  tenantPool(): Pool {
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return this.dbPool;
  }

  /** Runs `fn` inside the guard-resolved tenant of the current request. */
  inScope<T>(fn: (client: TenantClient) => Promise<T>): Promise<T> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return withTenant(this.dbPool, scope.organisationId, fn, {
      actorId: scope.actorId,
      correlationId: auditCorrelationId(),
    });
  }

  /** Runs `fn` inside the named organisation: the accept flow's invitation row owns it. */
  inOrganisation<T>(organisationId: string, fn: (client: TenantClient) => Promise<T>): Promise<T> {
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return withTenant(this.dbPool, organisationId, fn, { correlationId: auditCorrelationId() });
  }
}
