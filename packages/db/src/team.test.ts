/**
 * Team workflows (P22 SELL): routes + shows + carries + role views.
 */
import { describe, expect, it } from 'vitest';
import { assignRoutes, handoffCarries, presenceShows, viewTasks } from './team.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('team workflows', () => {
  it('routes assignments to member, pool, or role queue', () => {
    expect(assignRoutes(A, { kind: 'member', userId: B })).toEqual({
      taskId: A,
      target: { kind: 'member', userId: B },
    });
    expect(assignRoutes(A, { kind: 'pool' })?.target.kind).toBe('pool');
    expect(assignRoutes(A, { kind: 'role', role: 'staff' })?.target).toEqual({
      kind: 'role',
      role: 'staff',
    });
    expect(assignRoutes('nope', { kind: 'pool' })).toBe(null);
    expect(assignRoutes(A, { kind: 'member', userId: 'nope' })).toBe(null);
  });

  it('shows presence and carries handoff notes', () => {
    expect(presenceShows('online')).toBe('Verfügbar');
    expect(presenceShows('away')).toBe('Abwesend');
    expect(presenceShows('offline')).toBe('Offline');
    expect(handoffCarries({ fromUserId: A, toUserId: B, note: 'Rückruf 14 Uhr' })).toBe(true);
    expect(handoffCarries({ fromUserId: A, toUserId: B, note: '  ' })).toBe(false);
  });

  it('scopes views by role: owner all, admin non-sensitive+, staff own+pool', () => {
    const tasks = [
      { id: 't1', assigneeUserId: B, assigneeRole: 'staff', sensitive: false },
      { id: 't2', assigneeUserId: A, assigneeRole: 'owner', sensitive: true },
      { id: 't3', assigneeUserId: null, assigneeRole: null, sensitive: false },
    ] as const;
    expect(viewTasks([...tasks], { userId: A, role: 'owner' })).toHaveLength(3);
    expect(viewTasks([...tasks], { userId: B, role: 'admin' }).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);
    expect(viewTasks([...tasks], { userId: B, role: 'staff' }).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);
    expect(viewTasks([...tasks], { userId: A, role: 'staff' }).map((t) => t.id)).toEqual([
      't2',
      't3',
    ]);
  });
});
