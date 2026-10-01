/** An `afterEach` that throws alongside a genuine assertion failure. */
import { afterEach, describe, expect, it } from 'vitest';

describe('teardown fixture', () => {
  afterEach(() => {
    throw new Error('teardown blew up');
  });

  it('asserts and then the teardown fails', () => {
    expect(1).toBe(2);
  });
});
