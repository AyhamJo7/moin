/** Async matcher failures: the matcher itself must be the thing that fails. */
import { expect } from 'vitest';
import { evidenceTest } from '../../mutation-evidence-test.ts';

evidenceTest('a resolves matcher that itself fails', async () => {
  await expect(Promise.resolve(1)).resolves.toBe(2);
});

evidenceTest('a rejects matcher that itself fails', async () => {
  await expect(Promise.reject(new Error('actual'))).rejects.toThrow('expected');
});

evidenceTest('a rejects matcher on a promise that resolves', async () => {
  // Vitest raises this from inside its own async chain without running a matcher. Instrumenting the
  // `rejects`/`resolves` getters keeps it inside the trusted path.
  await expect(Promise.resolve(1)).rejects.toThrow('anything');
});

evidenceTest('a negated matcher that fails', () => {
  expect(1).not.toBe(1);
});
