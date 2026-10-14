/**
 * View states (P13.11.01): resolver order and retry gate.
 */
import { describe, expect, it } from 'vitest';
import { canRetry, resolveView } from './states.ts';

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
});
