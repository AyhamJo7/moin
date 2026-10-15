/**
 * Synthetic urgent canary (P14.08.01): fires, misses alarm.
 */
import { describe, expect, it } from 'vitest';
import { CANARY_LATENCY_MS, canaryAlarms, canaryOk } from './canary.ts';

describe('urgent canary', () => {
  it('fires when delivered within the latency bound', () => {
    expect(canaryOk({ firedAtMs: 0, deliveredAtMs: CANARY_LATENCY_MS })).toBe(true);
    expect(canaryOk({ firedAtMs: 0, deliveredAtMs: CANARY_LATENCY_MS + 1 })).toBe(false);
    expect(canaryOk({ firedAtMs: 0, deliveredAtMs: null })).toBe(false);
  });

  it('alarms on two consecutive misses, resets on success', () => {
    const miss = { firedAtMs: 0, deliveredAtMs: null };
    const ok = { firedAtMs: 0, deliveredAtMs: 1_000 };
    expect(canaryAlarms([miss])).toBe(false);
    expect(canaryAlarms([miss, miss])).toBe(true);
    expect(canaryAlarms([miss, miss, ok])).toBe(false);
    expect(canaryAlarms([miss, ok, miss])).toBe(false);
  });
});
