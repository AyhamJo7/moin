/**
 * Team workflows (P22.02 [G:SELL]): assignment routing + presence + handoff
 * notes. Assignment targets memberships (P06.07); unassigned work is visible
 * to all staff. Pure shapes; the task-write path and notification routing
 * ride separately.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface Assignment {
  readonly taskId: string;
  readonly assigneeUserId: string | null;
}

/** Route an assignment: valid ids, or unassign (null) back to the pool. */
export function assignRoutes(taskId: string, assigneeUserId: string | null): Assignment | null {
  if (!UUID_RE.test(taskId)) return null;
  if (assigneeUserId !== null && !UUID_RE.test(assigneeUserId)) return null;
  return { taskId, assigneeUserId };
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
