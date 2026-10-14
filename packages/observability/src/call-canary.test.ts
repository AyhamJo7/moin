/**
 * Synthetic call canary (P15.05.04): runs pass, failures alarm.
 */
import { describe, expect, it } from 'vitest';
import { callCanaryAlarms, canaryRunOk, CANARY_TURN_LATENCY_MS } from './call-canary.ts';

const PASS = {
  disclosurePlayed: true,
  sessionEstablished: true,
  callbackCaptured: true,
  latencyMs: CANARY_TURN_LATENCY_MS,
} as const;

const FAIL = { ...PASS, disclosurePlayed: false } as const;

describe('synthetic call canary', () => {
  it('passes runs through the full voice path within the latency bound', () => {
    expect(canaryRunOk({ ...PASS })).toBe(true);
    expect(canaryRunOk({ ...PASS, latencyMs: CANARY_TURN_LATENCY_MS + 1 })).toBe(false);
    expect(canaryRunOk({ ...FAIL })).toBe(false);
  });

  it('alarms on two consecutive failures, resets on success', () => {
    expect(callCanaryAlarms([{ ...FAIL }])).toBe(false);
    expect(callCanaryAlarms([{ ...FAIL }, { ...FAIL }])).toBe(true);
    expect(callCanaryAlarms([{ ...FAIL }, { ...FAIL }, { ...PASS }])).toBe(false);
    expect(callCanaryAlarms([{ ...FAIL }, { ...PASS }, { ...FAIL }])).toBe(false);
  });
});
