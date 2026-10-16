/**
 * Tenant termination (P16.06 LAUNCH): cascades + grace honoured.
 */
import { describe, expect, it } from 'vitest';
import { cascadeAllowed, terminationState, TERMINATION_GRACE_DAYS } from './termination.ts';

describe('tenant termination lifecycle', () => {
  it('honours the 30-day grace period', () => {
    expect(TERMINATION_GRACE_DAYS).toBe(30);
    expect(terminationState(false, 999)).toBe('active');
    expect(terminationState(true, 0)).toBe('terminating');
    expect(terminationState(true, 29)).toBe('terminating');
    expect(terminationState(true, 30)).toBe('deleted');
    expect(() => terminationState(true, -1)).toThrow(RangeError);
  });

  it('cascades only when deleted with export done', () => {
    expect(cascadeAllowed({ state: 'deleted', requestedDaysAgo: 30, exportDone: true })).toBe(true);
    expect(cascadeAllowed({ state: 'deleted', requestedDaysAgo: 30, exportDone: false })).toBe(
      false,
    );
    expect(cascadeAllowed({ state: 'terminating', requestedDaysAgo: 5, exportDone: true })).toBe(
      false,
    );
  });
});
