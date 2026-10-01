/**
 * A matcher object kept past the invocation that produced it (P06.10.07).
 *
 * The object's identity is genuine; its *binding* is not. Replay across tests, across retries and
 * across parameterized cases must all be refused, which is what the invocation id in the private
 * map is for.
 */
import { expect } from 'vitest';
import { evidenceTest } from '@moin/testing';

/** Smuggled out of one invocation so a later one can try to use it. */
let smuggled: unknown;

evidenceTest('8a test A keeps its matcher failure and passes', () => {
  try {
    expect(1).toBe(2);
  } catch (error) {
    smuggled = error;
  }
});

evidenceTest('8b test B throws test A matcher object', () => {
  throw smuggled;
});

let fromFirstAttempt: unknown;
let attempts = 0;

evidenceTest(
  '9 a retried test reuses the first attempt matcher object',
  () => {
    attempts += 1;
    if (attempts === 1) {
      try {
        expect(1).toBe(2);
      } catch (error) {
        fromFirstAttempt = error;
        throw error;
      }
    }
    // The retry. The object is real and it is the same object, but it was recorded under the
    // previous invocation, and only the final attempt is reported.
    throw fromFirstAttempt;
  },
  { retry: 1 },
);

let fromCaseA: unknown;

for (const label of ['a', 'b'] as const) {
  evidenceTest(`10 parameterized case ${label}`, () => {
    if (label === 'a') {
      try {
        expect(1).toBe(2);
      } catch (error) {
        fromCaseA = error;
        throw error;
      }
    }
    throw fromCaseA;
  });
}
