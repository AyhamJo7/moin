/**
 * Team workflows (P22 SELL): routes + shows + carries.
 */
import { describe, expect, it } from 'vitest';
import { assignRoutes, handoffCarries, presenceShows } from './team.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('team workflows', () => {
  it('routes assignments to members or back to the pool', () => {
    expect(assignRoutes(A, B)).toEqual({ taskId: A, assigneeUserId: B });
    expect(assignRoutes(A, null)?.assigneeUserId).toBe(null);
    expect(assignRoutes('nope', B)).toBe(null);
    expect(assignRoutes(A, 'nope')).toBe(null);
  });

  it('shows presence and carries handoff notes', () => {
    expect(presenceShows('online')).toBe('Verfügbar');
    expect(presenceShows('away')).toBe('Abwesend');
    expect(presenceShows('offline')).toBe('Offline');
    expect(handoffCarries({ fromUserId: A, toUserId: B, note: 'Rückruf 14 Uhr' })).toBe(true);
    expect(handoffCarries({ fromUserId: A, toUserId: B, note: '  ' })).toBe(false);
  });
});
