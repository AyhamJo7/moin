/**
 * Tenant transactions for the Today read and the simulated-call capture (M1 vertical slice,
 * INV-01, INV-02).
 *
 * Lives in `platform/` — the one place allowed to hold the raw tenant pool — so the work and
 * call-simulator controllers never touch a pool. Two entries, and the organisation each enters
 * comes from a server-side resolution, never from the request:
 *
 * - `today()` enters the guard-resolved session's organisation;
 * - `task()` and `complete()` enter the same session organisation, and `complete()` records the
 *   session's user as the audit actor;
 * - `captureCallback()` enters the organisation the dialled number's route resolved to.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  TaskVersionConflictError,
  captureCallbackRequest,
  completeTask,
  getTask,
  listTodayTasks,
  lockTask,
  withTenant,
  type CallbackRequest,
  type CapturedCallback,
  type Task,
  type TodayTaskRow,
} from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { may } from '../identity-access/domain/roles.ts';
import { auditCorrelationId } from './member-queries.ts';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

export type CompleteOutcome =
  | { readonly kind: 'completed'; readonly task: Task }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'missing' };

@Injectable()
export class WorkQueries {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  private tenantPool(): Pool {
    if (this.pool === null) throw new Error('no tenant pool');
    return this.pool;
  }

  /** Live tasks of the current request's organisation (guarded routes only). */
  today(limit: number): Promise<{ tasks: TodayTaskRow[]; truncated: boolean }> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    return withTenant(this.tenantPool(), scope.organisationId, (client) =>
      listTodayTasks(client, limit),
    );
  }

  /** One task of the session's organisation in any status; null when none is visible to it. */
  task(taskId: string): Promise<Task | null> {
    const scope = this.scope();
    return withTenant(this.tenantPool(), scope.organisationId, (client) => getTask(client, taskId));
  }

  /**
   * Complete a task for the signed-in member (P13.03.02). One transaction: the task row is locked
   * first, who may act on it is judged on that locked row, then every rung of the state machine
   * and its audit events commit together or not at all. Owners and admins act on any task of the
   * tenant; staff only on a task assigned to themselves or unassigned (PLAN Authorisation); any
   * other role fails closed. A refused member writes nothing, not even an audit row. A version or
   * lifecycle conflict throws out of `withTenant`, which rolls the whole walk back, and is
   * reported here as `conflict`; a task row the tenant cannot see is `missing`, whoever owns it.
   */
  async complete(taskId: string, version: number): Promise<CompleteOutcome> {
    const scope = this.scope();
    try {
      return await withTenant(
        this.tenantPool(),
        scope.organisationId,
        async (client): Promise<CompleteOutcome> => {
          const task = await lockTask(client, taskId);
          if (task === null) return { kind: 'missing' };
          const anyTask = may(scope.role, scope.permissions, 'tasks:act-on-any');
          const ownOrUnassigned =
            scope.role === 'staff' &&
            (task.assigneeUserId === null || task.assigneeUserId === scope.actorId);
          if (!anyTask && !ownOrUnassigned) return { kind: 'forbidden' };
          return { kind: 'completed', task: await completeTask(client, taskId, version) };
        },
        { actorId: scope.actorId, correlationId: auditCorrelationId() },
      );
    } catch (error) {
      if (error instanceof TaskVersionConflictError) return { kind: 'conflict' };
      throw error;
    }
  }

  private scope() {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    return scope;
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
