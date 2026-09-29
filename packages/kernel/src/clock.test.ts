import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from './clock.ts';

describe('clock', () => {
  it('the system clock reports the real time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it('a fixed clock does not move on its own', () => {
    const clock = fixedClock(new Date('2026-12-24T17:30:00Z'));
    const first = clock.now();
    const second = clock.now();
    expect(second.toISOString()).toBe(first.toISOString());
  });

  it('advances only when told to', () => {
    const clock = fixedClock(new Date('2026-12-24T17:30:00Z'));
    clock.advance(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2026-12-24T19:00:00.000Z');
  });

  it('hands out copies, so a caller cannot mutate the clock through the Date it received', () => {
    const clock = fixedClock(new Date('2026-12-24T17:30:00Z'));
    const handed = clock.now();
    handed.setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
