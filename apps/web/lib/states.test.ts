/**
 * View states (P13.11.01/.02): resolver order, retry gate, per-view states,
 * error/offline lines, layout tokens.
 */
import { describe, expect, it } from 'vitest';
import {
  canRetry,
  errorLine,
  LAYOUT_TOKENS,
  offlineLine,
  OWNER_VIEWS,
  resolveView,
  resolveViews,
} from './states.ts';

describe('view states', () => {
  it('resolves failure first, then loading, then empty', () => {
    expect(resolveView({ loading: true, failed: true, itemCount: 3 })).toBe('error');
    expect(resolveView({ loading: true, failed: false, itemCount: 0 })).toBe('loading');
    expect(resolveView({ loading: false, failed: false, itemCount: 0 })).toBe('empty');
    expect(resolveView({ loading: false, failed: false, itemCount: 2 })).toBe('ready');
  });

  it('offers retry only from the error state', () => {
    expect(canRetry('error')).toBe(true);
    expect(canRetry('loading')).toBe(false);
    expect(canRetry('empty')).toBe(false);
    expect(canRetry('ready')).toBe(false);
  });

  it('resolves a state for every owner view', () => {
    const states = resolveViews({
      today: { loading: false, failed: false, itemCount: 2 },
      inbox: { loading: true, failed: false, itemCount: 0 },
      customers: { loading: false, failed: true, itemCount: 0 },
      knowledge: { loading: false, failed: false, itemCount: 0 },
      settings: { loading: false, failed: false, itemCount: 1 },
      morning: { loading: false, failed: false, itemCount: 0 },
    });
    expect(states.today).toBe('ready');
    expect(states.inbox).toBe('loading');
    expect(states.customers).toBe('error');
    expect(states.knowledge).toBe('empty');
    expect(states.settings).toBe('ready');
    expect(states.morning).toBe('empty');
    expect(Object.keys(states).sort()).toEqual([...OWNER_VIEWS].sort());
  });

  it('carries the correlation id in the error line and tokens at 360/768/1280', () => {
    expect(errorLine('abc-123')).toContain('abc-123');
    expect(offlineLine().length).toBeGreaterThan(0);
    expect(LAYOUT_TOKENS.phonePx).toBe(360);
    expect(LAYOUT_TOKENS.tabletPx).toBe(768);
    expect(LAYOUT_TOKENS.desktopPx).toBe(1280);
  });
});
