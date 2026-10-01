/**
 * Concurrent tests, which the probe refuses to vouch for.
 *
 * Measured on Vitest 5.0.2: under `it.concurrent` the module-level `expect.getState()` reports
 * another test's `currentTestName`, so a matcher failure cannot be attributed by assertion state.
 * The probe detects the overlapping invocation windows instead and marks them `suspect`, which
 * every consumer treats as not-evidence. Refusing to answer beats answering wrongly.
 */
import { expect } from 'vitest';
import { concurrentEvidenceTest } from '../../mutation-evidence-test.ts';

concurrentEvidenceTest('concurrent A fails a matcher', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(1).toBe(2);
});

concurrentEvidenceTest('concurrent B fails a matcher', async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(3).toBe(4);
});
