/**
 * Realtime state (P13.10.01–.02): live/stale from silence, poll fallback.
 */
import { describe, expect, it } from 'vitest';
import { connectionState, onFrame, shouldPoll } from './realtime.ts';

describe('realtime', () => {
  it('advances the cursor, never backwards', () => {
    const cursor = onFrame({ lastEventId: 7, lastSeenAtMs: 1000 }, 9, 2000);
    expect(cursor).toStrictEqual({ lastEventId: 9, lastSeenAtMs: 2000 });
    expect(onFrame(cursor, 5, 3000).lastEventId).toBe(9);
  });

  it('goes stale after 2 min of silence, polls only when not live', () => {
    const cursor = { lastEventId: 9, lastSeenAtMs: 0 };
    expect(connectionState(cursor, 119_999)).toBe('live');
    expect(connectionState(cursor, 120_001)).toBe('stale');
    expect(shouldPoll('live')).toBe(false);
    expect(shouldPoll('stale')).toBe(true);
    expect(shouldPoll('offline')).toBe(true);
  });
});
