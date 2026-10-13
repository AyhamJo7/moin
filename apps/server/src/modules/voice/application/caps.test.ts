/**
 * Abuse/cost/concurrency caps (P11.12.06, LG-P17): one test per cap plus
 * the allowance alert ladder.
 */
import { describe, expect, it } from 'vitest';
import { ABUSE_BLOCKED_METRIC, allowanceAlert, checkCaps } from './caps.ts';
import type { CapCounters } from './caps.ts';

function counters(over: Partial<CapCounters> = {}): CapCounters {
  return {
    callerCallsLastHour: 1,
    activeSessions: 1,
    callDurationMs: 60_000,
    nluTurns: 3,
    allowanceUsedPct: 10,
    allowanceHardCap: false,
    blockedNumbers: new Set(),
    ...over,
  };
}

describe('abuse, cost and concurrency caps', () => {
  it('admits a call inside every cap', () => {
    expect(checkCaps('+49151', counters())).toStrictEqual({ ok: true });
    expect(ABUSE_BLOCKED_METRIC).toBe('voice.abuse.blocked');
  });

  it('refuses each cap with its reason', () => {
    expect(checkCaps('+49151', counters({ blockedNumbers: new Set(['+49151']) }))).toMatchObject({
      ok: false,
      refusal: 'blocked-number',
    });
    expect(checkCaps('+49151', counters({ callerCallsLastHour: 6 }))).toMatchObject({
      ok: false,
      refusal: 'caller-rate-limited',
    });
    expect(checkCaps('+49151', counters({ activeSessions: 3 }))).toMatchObject({
      ok: false,
      refusal: 'concurrent-cap',
    });
    expect(checkCaps('+49151', counters({ callDurationMs: 15 * 60_000 }))).toMatchObject({
      ok: false,
      refusal: 'duration-cap',
    });
    expect(checkCaps('+49151', counters({ nluTurns: 30 }))).toMatchObject({
      ok: false,
      refusal: 'nlu-turn-cap',
    });
    expect(
      checkCaps('+49151', counters({ allowanceUsedPct: 100, allowanceHardCap: true })),
    ).toMatchObject({ ok: false, refusal: 'allowance-exhausted' });
    // Soft cap without hard-cap enforcement still admits (alerts only).
    expect(
      checkCaps('+49151', counters({ allowanceUsedPct: 100, allowanceHardCap: false })),
    ).toStrictEqual({ ok: true });
  });

  it('alerts at 80 % and 100 % (LG-P17 cost-cap drill shape)', () => {
    expect(allowanceAlert(10)).toBe('none');
    expect(allowanceAlert(80)).toBe('warn');
    expect(allowanceAlert(99)).toBe('warn');
    expect(allowanceAlert(100)).toBe('exhausted');
  });
});
