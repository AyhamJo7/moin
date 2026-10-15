/**
 * Booking slot bounds (P20 SELL): pure validation gates. The integration
 * test proves the rows; this test is the mutation target.
 */
import { describe, expect, it } from 'vitest';
import { HOLD_TTL_MS } from './booking.ts';

describe('booking validation', () => {
  it('holds the 2-minute TTL', () => {
    expect(HOLD_TTL_MS).toBe(120_000);
  });
});
