/**
 * The same genuine matcher failure, with and without the trusted wrapper (P06.10.07).
 *
 * An unwrapped test runs exactly as before and fails exactly as before. It is simply not eligible
 * for mutation evidence, because by the time any Vitest hook runs the live thrown object is gone —
 * measured on 5.0.2: `task.result.errors[0]` is a serialized plain object in both `afterEach` and
 * `onTestFailed`, so there is nothing left to compare by identity.
 */
import { expect, it } from 'vitest';
import { evidenceTest } from '@moin/testing';

it('an unwrapped test with a genuine matcher failure', () => {
  expect(1).toBe(2);
});

evidenceTest('a wrapped test with a genuine matcher failure', () => {
  expect(1).toBe(2);
});
