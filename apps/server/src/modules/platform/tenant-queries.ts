/**
 * Tenant-scoped queries for handlers (P06.06.03, INV-01, INV-02).
 *
 * Lives in `platform/` — the one place allowed to hold raw pools — so controllers and tests
 * never import the pool entry and never name the pool type. Handlers resolve their organisation
 * from the guard scope and call through here; the organisation id passed to `withTenant` is
 * always the guard-resolved one, never a caller claim.
 */

import { Inject, Injectable } from '@nestjs/common';
import { type TenantClient, withTenant } from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

@Injectable()
export class TenantQueries {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  /** Rows visible to the request's organisation through the tenant policy. */
  async countMemberships(): Promise<number> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    if (this.pool === null) {
      throw new Error('no tenant pool');
    }
    const rows = await withTenant(
      this.pool,
      scope.organisationId,
      (client: TenantClient) =>
        client
          .query<{ n: string }>('select count(*)::text as n from memberships')
          .then((r) => r.rows),
      { actorId: scope.actorId },
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** The guard-resolved organisation of the current request. */
  organisationId(): string {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    return scope.organisationId;
  }
}
