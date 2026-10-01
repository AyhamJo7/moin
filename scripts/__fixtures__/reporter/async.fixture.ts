/** Async matcher failures: the matcher itself must be the thing that fails. */
import { expect, it } from 'vitest';

it('a resolves matcher that itself fails', async () => {
  await expect(Promise.resolve(1)).resolves.toBe(2);
});

it('a rejects matcher that itself fails', async () => {
  await expect(Promise.reject(new Error('actual'))).rejects.toThrow('expected');
});

it('a rejects matcher on a promise that resolves', async () => {
  // Vitest rejects this before any matcher runs, so there is no matcher failure to record.
  await expect(Promise.resolve(1)).rejects.toThrow('anything');
});

it('a negated matcher that fails', () => {
  expect(1).not.toBe(1);
});
