/**
 * Call debug timeline (P15.06): orders events, holds the redaction line.
 */
import { describe, expect, it } from 'vitest';
import { eventIsRedacted, orderTimeline } from './debug-timeline.ts';

describe('call debug timeline', () => {
  it('orders voice/session/NLU/tool events by timestamp', () => {
    const ordered = orderTimeline([
      { atMs: 300, kind: 'tool', code: 'tools.executed' },
      { atMs: 100, kind: 'webhook', code: 'voice.calls.inbound' },
      { atMs: 200, kind: 'nlu', code: 'intent.callback' },
    ]);
    expect(ordered.map((e) => e.kind)).toEqual(['webhook', 'nlu', 'tool']);
  });

  it('holds codes-only with no caller text', () => {
    expect(
      eventIsRedacted({ atMs: 0, kind: 'turn', code: 'voice.turn.latency', latencyMs: 900 }),
    ).toBe(true);
    expect(eventIsRedacted({ atMs: 0, kind: 'nlu', code: '' })).toBe(false);
    expect(
      eventIsRedacted({ atMs: 0, kind: 'turn', code: 'voice.turn.latency', latencyMs: -1 }),
    ).toBe(false);
  });
});
