/**
 * Tasks (P07.06.02): the universal next action (ADR-0015).
 *
 * The state machine is the strict PLAN chain open → in_progress → waiting → done, with
 * cancelled reachable from any live rung and reopen returning done → open. Transitions are compare-and-hold on
 * (status, version): an illegal move or a stale version is a VersionConflictError (409 at the
 * HTTP layer), never a silent rewrite. System-created tasks (duplicate review, reconciler
 * fallbacks) carry an idempotency key: creation retries return the existing row.
 *
 * All writes run inside `withTenant`; every mutation audits with opaque markers only (INV-12).
 * Due dates are UTC instants — the tenant time zone renders them, storage never shifts.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
export type TaskType = 'callback' | 'review' | 'booking' | 'follow_up' | 'general';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Version or transition conflicts surface as 409 at the HTTP layer. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const STATUS_MARKER: Record<TaskStatus, number> = {
  open: 0,
  in_progress: 1,
  waiting: 2,
  done: 3,
  cancelled: 4,
};

const TYPE_MARKER: Record<TaskType, number> = {
  callback: 0,
  review: 1,
  booking: 2,
  follow_up: 3,
  general: 4,
};

/** Legal moves (PLAN P07.06.01 strict chain). `reopen` is done → open only; cancelled is terminal. */
const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['waiting', 'cancelled'],
  waiting: ['done', 'cancelled'],
  done: ['open'],
  cancelled: [],
};

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly type: TaskType | null;
  readonly priority: TaskPriority;
  readonly assigneeUserId: string | null;
  readonly dueAt: Date | null;
  readonly snoozedUntil: Date | null;
  readonly conversationId: string | null;
  readonly version: number;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  type: string | null;
  priority: string;
  assignee_user_id: string | null;
  due_at: Date | null;
  snoozed_until: Date | null;
  conversation_id: string | null;
  version: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    type: (row.type ?? null) as TaskType | null,
    priority: row.priority as TaskPriority,
    assigneeUserId: row.assignee_user_id,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    conversationId: row.conversation_id,
    version: Number(row.version),
  };
}

export interface NewTask {
  readonly title: string;
  readonly type?: TaskType | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly assigneeUserId?: string | undefined;
  readonly dueAt?: Date | undefined;
  readonly conversationId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 72) {
    throw new RangeError('task title must be 1..72 characters');
  }
  return trimmed;
}

/**
 * Create a task. With an idempotency key the call is safe to retry: the per-tenant unique
 * index serialises concurrent creates and the existing row is returned (first write wins).
 */
export async function createTask(client: TenantClient, input: NewTask): Promise<Task> {
  const title = checkTitle(input.title);
  if (input.idempotencyKey !== undefined) {
    const key = input.idempotencyKey.trim();
    if (key.length === 0 || key.length > 100) throw new RangeError('idempotency key is empty');
    const id = randomUUID();
    const inserted = await client.query<TaskRow>(
      `insert into tasks
         (organisation_id, id, title, type, priority, assignee_user_id, due_at,
          conversation_id, idempotency_key)
       values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (organisation_id, idempotency_key) do nothing
       returning id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text`,
      [
        id,
        title,
        input.type ?? null,
        input.priority ?? 'normal',
        input.assigneeUserId ?? null,
        input.dueAt?.toISOString() ?? null,
        input.conversationId ?? null,
        key,
      ],
    );
    const won = inserted.rows[0];
    if (won !== undefined) {
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'task.create',
        targetKind: 'task',
        targetId: won.id,
        argsSanitized: { task_type: input.type === undefined ? 9 : TYPE_MARKER[input.type] },
        result: 'succeeded',
      });
      return toTask(won);
    }
    const existing = await client.query<TaskRow>(
      `select id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text from tasks where idempotency_key = $1`,
      [key],
    );
    const found = existing.rows[0];
    if (found === undefined) throw new Error('conflicting task row vanished');
    return toTask(found);
  }
  const id = randomUUID();
  const result = await client.query<TaskRow>(
    `insert into tasks
       (organisation_id, id, title, type, priority, assignee_user_id, due_at, conversation_id)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7)
     returning id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text`,
    [
      id,
      title,
      input.type ?? null,
      input.priority ?? 'normal',
      input.assigneeUserId ?? null,
      input.dueAt?.toISOString() ?? null,
      input.conversationId ?? null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('task insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'task.create',
    targetKind: 'task',
    targetId: id,
    argsSanitized: { task_type: input.type === undefined ? 9 : TYPE_MARKER[input.type] },
    result: 'succeeded',
  });
  return toTask(row);
}

async function loadTask(client: TenantClient, taskId: string): Promise<TaskRow> {
  const result = await client.query<TaskRow>(
    `select id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text from tasks where id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new VersionConflictError(`task ${taskId} not found`);
  return row;
}

/**
 * Move a task along the machine. Illegal transitions and stale versions are
 * VersionConflictError; the guarded UPDATE serialises concurrent movers (loser re-reads and
 * reports conflict rather than overwriting).
 */
export async function setTaskStatus(
  client: TenantClient,
  taskId: string,
  next: TaskStatus,
  version: number,
): Promise<Task> {
  const current = await loadTask(client, taskId);
  const from = current.status as TaskStatus;
  if (!TRANSITIONS[from].includes(next)) {
    throw new VersionConflictError(`illegal task transition ${from} → ${next}`);
  }
  const moved = await client.query<TaskRow>(
    `update tasks set status = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and version = $3
     returning id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text`,
    [taskId, next, version],
  );
  const row = moved.rows[0];
  if (row === undefined) throw new VersionConflictError(`task ${taskId} version mismatch`);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'task.status',
    targetKind: 'task',
    targetId: taskId,
    argsSanitized: { to_status: STATUS_MARKER[next] },
    result: 'succeeded',
  });
  return toTask(row);
}

/** Reopen a done task: done → open, the only backward move the machine allows. */
export async function reopenTask(
  client: TenantClient,
  taskId: string,
  version: number,
): Promise<Task> {
  return setTaskStatus(client, taskId, 'open', version);
}

/** Complete walks the strict chain carrying versions forward (open needs three guarded moves). */
export async function completeTask(
  client: TenantClient,
  taskId: string,
  version: number,
): Promise<Task> {
  const current = await loadTask(client, taskId);
  if (Number(current.version) !== version) {
    throw new VersionConflictError(`task ${taskId} version mismatch`);
  }
  let task = toTask(current);
  for (const rung of ['in_progress', 'waiting', 'done'] as const) {
    if (task.status === 'done' || task.status === 'cancelled') break;
    if (TRANSITIONS[task.status].includes(rung)) {
      task = await setTaskStatus(client, task.id, rung, task.version);
    }
  }
  if (task.status !== 'done') {
    throw new VersionConflictError(`cannot complete from ${task.status}`);
  }
  return task;
}

export async function assignTask(
  client: TenantClient,
  taskId: string,
  assigneeUserId: string | null,
  version: number,
): Promise<Task> {
  if (assigneeUserId !== null && !UUID_RE.test(assigneeUserId)) {
    throw new RangeError('assignee must be a user id or null');
  }
  const moved = await client.query<TaskRow>(
    `update tasks set assignee_user_id = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and version = $3
     returning id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text`,
    [taskId, assigneeUserId, version],
  );
  const row = moved.rows[0];
  if (row === undefined) throw new VersionConflictError(`task ${taskId} version mismatch`);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'task.assign',
    targetKind: 'task',
    targetId: taskId,
    argsSanitized: { assigned: assigneeUserId === null ? 0 : 1 },
    result: 'succeeded',
  });
  return toTask(row);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Snooze parks the task until the given instant without touching its rung. */
export async function snoozeTask(
  client: TenantClient,
  taskId: string,
  until: Date,
  version: number,
): Promise<Task> {
  if (!Number.isFinite(until.getTime())) throw new RangeError('snooze instant is invalid');
  const moved = await client.query<TaskRow>(
    `update tasks set snoozed_until = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and version = $3
     returning id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text`,
    [taskId, until.toISOString(), version],
  );
  const row = moved.rows[0];
  if (row === undefined) throw new VersionConflictError(`task ${taskId} version mismatch`);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'task.snooze',
    targetKind: 'task',
    targetId: taskId,
    argsSanitized: { snoozed: 1 },
    result: 'succeeded',
  });
  return toTask(row);
}

export async function listOpenTasks(client: TenantClient, limit = 50): Promise<Task[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const result = await client.query<TaskRow>(
    `select id, title, status, type, priority, assignee_user_id, due_at,
  snoozed_until, conversation_id, version::text from tasks where status in ('open', 'in_progress', 'waiting')
     order by created_at limit $1`,
    [capped],
  );
  return result.rows.map(toTask);
}
