/**
 * Usage metering (P11.13.03): duplicates never double-meter, aggregation
 * adds per meter, transfers/SMS stay separate.
 */
import { describe, expect, it } from 'vitest';
import { createMetering } from './metering.ts';

describe('usage metering', () => {
  it('duplicates never double-meter (same CallSid + meter once)', () => {
    const metering = createMetering();
    expect(metering.record({ callSid: 'CA1', meter: 'voice_seconds', amount: 120 })).toBe(true);
    expect(metering.record({ callSid: 'CA1', meter: 'voice_seconds', amount: 120 })).toBe(false);
    // Same call, different meter: recorded (minutes + turns + tokens).
    expect(metering.record({ callSid: 'CA1', meter: 'nlu_turns', amount: 6 })).toBe(true);
  });

  it('aggregates per meter; transfers and SMS stay separate', () => {
    const metering = createMetering();
    const totals = metering.aggregate([
      { callSid: 'CA1', meter: 'voice_seconds', amount: 120 },
      { callSid: 'CA2', meter: 'voice_seconds', amount: 60 },
      { callSid: 'CA1', meter: 'nlu_turns', amount: 6 },
      { callSid: 'CA1', meter: 'llm_tokens', amount: 900 },
      { callSid: 'CA3', meter: 'transfer', amount: 1 },
      { callSid: 'CA4', meter: 'sms', amount: 2 },
    ]);
    expect(totals).toStrictEqual({
      voice_seconds: 180,
      nlu_turns: 6,
      llm_tokens: 900,
      transfer: 1,
      sms: 2,
    });
  });
});
