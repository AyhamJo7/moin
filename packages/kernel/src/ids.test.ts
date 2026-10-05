import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.ts';
import { uuidv7 } from './ids.ts';

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('has the RFC 9562 version and variant', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(uuidv7()).toMatch(SHAPE);
    }
  });

  it('carries the clock time in its first 48 bits', () => {
    const at = new Date('2026-10-02T08:00:00.123Z');
    const id = uuidv7(fixedClock(at));
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(at.getTime());
  });

  it('sorts by time and never repeats', () => {
    const clock = fixedClock(new Date('2026-10-02T08:00:00.000Z'));
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      ids.push(uuidv7(clock));
      clock.advance(1);
    }
    expect([...ids].sort()).toStrictEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a time it cannot encode', () => {
    expect(() => uuidv7(fixedClock(new Date(-1)))).toThrow(RangeError);
  });
});
