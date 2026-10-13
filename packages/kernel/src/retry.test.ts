/**
 * Worker retry arithmetic (P08.05.02–.03). Pure unit tests, jitter pinned.
 */
import { describe, expect, it } from 'vitest';
import { backoffSeconds, decideRetry, isPoison } from './retry.ts';

describe('retry', () => {
  it('backs off exponentially with bounded jitter', () => {
    // Pinned random: u=0 → −20 %, u=1 → +20 %.
    expect(backoffSeconds(0, () => 0)).toBe(24);
    expect(backoffSeconds(0, () => 1)).toBe(36);
    expect(backoffSeconds(1, () => 0.5)).toBe(120);
    expect(backoffSeconds(99, () => 0.5)).toBe(1800);
  });

  it('retries until max attempts, then DLQ', () => {
    expect(decideRetry('sweep-run', 0, () => 0.5).toDlq).toBe(false);
    expect(decideRetry('sweep-run', 1, () => 0.5).toDlq).toBe(false);
    const last = decideRetry('sweep-run', 2, () => 0.5);
    expect(last.toDlq).toBe(true);
    expect(last.delaySeconds).toBe(0);
    // Unknown types get the default budget of 3.
    expect(decideRetry('nope', 2, () => 0.5).toDlq).toBe(true);
  });

  it('RangeErrors are poison, everything else transient', () => {
    expect(isPoison(new RangeError('schema'))).toBe(true);
    expect(isPoison(new Error('db down'))).toBe(false);
    expect(isPoison('string')).toBe(false);
  });
});
