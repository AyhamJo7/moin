/**
 * Booking validation (P20 SELL): TTL + refusal shape. The integration test
 * proves the rows; this test is the mutation target.
 */
import { describe, expect, it } from 'vitest';
import { HoldRefused, HOLD_TTL_MS } from './booking.ts';

describe('booking validation', () => {
  it('holds the 2-minute TTL', () => {
    expect(HOLD_TTL_MS).toBe(120_000);
  });

  it('refuses with a named HoldRefused error', () => {
    const err = new HoldRefused('slot unavailable: overlapping active hold');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HoldRefused');
    expect(err.message).toContain('unavailable');
  });
});
