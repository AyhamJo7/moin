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
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

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
    return withTenant(this.dbPool, scope.organisationId, fn, { actorId: scope.actorId });
  }

  /** Runs `fn` inside the named organisation: the accept flow's invitation row owns it. */
  inOrganisation<T>(organisationId: string, fn: (client: TenantClient) => Promise<T>): Promise<T> {
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return withTenant(this.dbPool, organisationId, fn);
  }
}
