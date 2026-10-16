/**
 * Tenant transactions for the Today read and the simulated-call capture (M1 vertical slice,
 * INV-01, INV-02).
 *
 * Lives in `platform/` — the one place allowed to hold the raw tenant pool — so the work and
 * call-simulator controllers never touch a pool. Two entries, and the organisation each enters
 * comes from a server-side resolution, never from the request:
 *
 * - `today()` enters the guard-resolved session's organisation;
 * - `captureCallback()` enters the organisation the dialled number's route resolved to.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  captureCallbackRequest,
  listTodayTasks,
  withTenant,
  type CallbackRequest,
  type CapturedCallback,
  type TodayTaskRow,
} from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { auditCorrelationId } from './member-queries.ts';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

@Injectable()
export class WorkQueries {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  private tenantPool(): Pool {
    if (this.pool === null) throw new Error('no tenant pool');
    return this.pool;
  }

  /** Live tasks of the current request's organisation (guarded routes only). */
  today(limit: number): Promise<TodayTaskRow[]> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    return withTenant(this.tenantPool(), scope.organisationId, (client) =>
      listTodayTasks(client, limit),
    );
  }

  /** Record a completed callback call in the organisation its dialled number routes to. */
  captureCallback(organisationId: string, request: CallbackRequest): Promise<CapturedCallback> {
    return withTenant(
      this.tenantPool(),
      organisationId,
      (client) => captureCallbackRequest(client, request),
      // The request's own id, so the audit rows join the request's log lines (P06.10.03).
      { correlationId: auditCorrelationId() },
    );
  }
}
