/** A `beforeAll` that throws, which is what an unreachable database looks like. */
import { beforeAll, describe, expect, it } from 'vitest';

describe('hook fixture', () => {
  beforeAll(() => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:59999');
  });

  it('never runs', () => {
    expect(1).toBe(1);
  });
});
