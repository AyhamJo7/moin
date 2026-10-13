/**
 * SSE channel format (P08.08.01–.02): addressing, frames, heartbeat, reconnect.
 * Pure unit tests, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  SSE_DEGRADED_POLL_S,
  SSE_HEARTBEAT_S,
  channelFor,
  parseLastEventId,
  renderFrame,
  renderHeartbeat,
} from './sse-channel.ts';

describe('sse-channel', () => {
  it('channels scope to org + user', () => {
    const channel = channelFor('org-1', 'user-1');
    expect(channel).toContain('org-1');
    expect(channel).toContain('user-1');
    expect(channelFor('org-1', 'user-2')).not.toBe(channel);
    expect(channelFor('org-2', 'user-1')).not.toBe(channel);
  });

  it('frames carry id, event and data', () => {
    const frame = renderFrame({ eventId: 42, type: 'task.created', payload: { a: 'b' } });
    expect(frame).toContain('id: 42');
    expect(frame).toContain('event: task.created');
    expect(frame).toContain('data: {"a":"b"}');
  });

  it('heartbeat is a comment, intervals match PLAN', () => {
    expect(SSE_HEARTBEAT_S).toBe(20);
    expect(SSE_DEGRADED_POLL_S).toBe(30);
    expect(renderHeartbeat()).toBe(': heartbeat\n\n');
  });

  it('Last-Event-ID parses forgivingly', () => {
    expect(parseLastEventId(undefined)).toBe(0);
    expect(parseLastEventId('12')).toBe(12);
    expect(parseLastEventId('garbage')).toBe(0);
    expect(parseLastEventId('-3')).toBe(0);
  });
});
