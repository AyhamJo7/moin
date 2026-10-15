/**
 * Team workflows (P22.02 [G:SELL]): assignment routing (member/pool/role) +
 * presence + handoff notes + role-scoped views. Assignment targets
 * memberships (P06.07); unassigned work is visible to all staff. Roles are
 * the P06.07 vocabulary (owner/admin/staff). Pure shapes; the task-write
 * path and notification routing ride separately.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type TeamRole = 'owner' | 'admin' | 'staff';

export type AssignTarget =
  | { readonly kind: 'member'; readonly userId: string }
  | { readonly kind: 'pool' }
  | { readonly kind: 'role'; readonly role: TeamRole };

export interface Assignment {
  readonly taskId: string;
  readonly target: AssignTarget;
}

/** Route an assignment: member id, pool (unassign), or role queue. */
export function assignRoutes(taskId: string, target: AssignTarget): Assignment | null {
  if (!UUID_RE.test(taskId)) return null;
  if (target.kind === 'member' && !UUID_RE.test(target.userId)) return null;
  return { taskId, target };
}

export type Presence = 'online' | 'away' | 'offline';

/** Presence display per staff member (German labels). */
export function presenceShows(presence: Presence): string {
  if (presence === 'online') return 'Verfügbar';
  if (presence === 'away') return 'Abwesend';
  return 'Offline';
}

export interface Handoff {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly note: string;
}

/** Handoff carries the note between staff (non-empty, capped). */
export function handoffCarries(handoff: Handoff): boolean {
  if (!UUID_RE.test(handoff.fromUserId) || !UUID_RE.test(handoff.toUserId)) return false;
  const note = handoff.note.trim();
  return note.length > 0 && note.length <= 500;
}

export interface ViewTask {
  readonly id: string;
  readonly assigneeUserId: string | null;
  readonly assigneeRole: TeamRole | null;
  readonly sensitive: boolean;
}

/**
 * Role-scoped view: owners see everything; admins see non-sensitive plus
 * their own; staff see their own assignments plus the unassigned pool.
 */
export function viewTasks(
  tasks: readonly ViewTask[],
  viewer: { userId: string; role: TeamRole },
): readonly ViewTask[] {
  if (viewer.role === 'owner') return tasks;
  if (viewer.role === 'admin') {
    return tasks.filter((task) => !task.sensitive || task.assigneeUserId === viewer.userId);
  }
  return tasks.filter(
    (task) => task.assigneeUserId === viewer.userId || task.assigneeUserId === null,
  );
}
