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
  IdempotencyMismatchError,
  TaskVersionConflictError,
  captureCallbackRequest,
  completeTask,
  executeIdempotent,
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
import { requireCapability } from '../identity-access/application/authorization.ts';
import { auditCorrelationId } from './member-queries.ts';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

/** Whether the role holds the capability to act on any task of the tenant. */
function holds(role: string, permissions: readonly string[]): boolean {
  try {
    requireCapability(role, permissions, 'tasks:act-on-any');
    return true;
  } catch {
    return false;
  }
}

/** What a completion answers with, and all its replay stores: no title, no content (INV-12). */
export interface CompletedTask {
  readonly id: string;
  readonly status: Task['status'];
  readonly version: number;
}

export type CompleteOutcome =
  | { readonly kind: 'completed'; readonly task: CompletedTask }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'missing' }
  /** The Idempotency-Key already names a different action (another task, version or member). */
  | { readonly kind: 'key-reused' };

/** A refusal leaves the transaction, so nothing it began (the idempotency row included) stays. */
class Refusal extends Error {
  public override readonly name = 'Refusal';

  public constructor(public readonly outcome: CompleteOutcome) {
    super('task completion refused');
  }
}

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
  async complete(
    taskId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<CompleteOutcome> {
    const scope = this.scope();
    try {
      return await withTenant(
        this.tenantPool(),
        scope.organisationId,
        async (client): Promise<CompleteOutcome> => {
          // One action per key (P08.04): this task, this version, this member. The same key again
          // replays the committed answer for 24 hours; with anything else it is refused. Only a
          // completion that commits keeps its key: a refusal or a conflict rolls the key back with
          // everything else, so repeating it decides again.
          const { result } = await executeIdempotent(client, {
            operation: 'task.complete',
            key: idempotencyKey,
            body: { taskId, version, actor: scope.actorId },
            execute: async (): Promise<CompletedTask> => {
              const task = await lockTask(client, taskId);
              if (task === null) throw new Refusal({ kind: 'missing' });
              // The member's standing is read again after the task is locked: disabling a member
              // unassigns their tasks (trigger), so a request that passed the session guard just
              // before would otherwise find the task unassigned and act on it. The role judged is
              // the committed one, not the one the guard resolved earlier.
              const standing = await client.query<{ role: string }>(
                "select role from memberships where user_id = $1 and status = 'active'",
                [scope.actorId],
              );
              const role = standing.rows[0]?.role;
              if (role === undefined) throw new Refusal({ kind: 'forbidden' });
              const anyTask = holds(role, scope.permissions);
              const ownOrUnassigned =
                role === 'staff' &&
                (task.assigneeUserId === null || task.assigneeUserId === scope.actorId);
              if (!anyTask && !ownOrUnassigned) throw new Refusal({ kind: 'forbidden' });
              const done = await completeTask(client, taskId, version);
              return { id: done.id, status: done.status, version: done.version };
            },
          });
          return { kind: 'completed', task: result };
        },
        { actorId: scope.actorId, correlationId: auditCorrelationId() },
      );
    } catch (error) {
      if (error instanceof Refusal) return error.outcome;
      if (error instanceof TaskVersionConflictError) return { kind: 'conflict' };
      if (error instanceof IdempotencyMismatchError) return { kind: 'key-reused' };
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
