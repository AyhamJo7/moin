/** An `afterEach` that throws alongside a genuine, wrapper-confirmed matcher failure. */
import { afterEach, describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';

describe('teardown fixture', () => {
  afterEach(() => {
    throw new Error('teardown blew up');
  });

  evidenceTest('asserts and then the teardown fails', () => {
    expect(1).toBe(2);
  });
});
