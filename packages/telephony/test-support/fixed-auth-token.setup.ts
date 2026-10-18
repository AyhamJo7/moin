/**
 * Setup for the fixed-auth-token run of the signature tests (`fixed-auth-token.vitest.config.ts`).
 *
 * `validate.test.ts` draws its auth token from `randomBytes(16)`, so which character its valid
 * signature starts with changes from run to run. Here that one call returns sixteen `0x49` bytes
 * (token `4949...49`), for which the real HMAC-SHA1 signature of the suite's URL and parameters
 * starts with `A`. Everything else in `node:crypto` is the real thing: signatures are computed and
 * verified by the production code, nothing is stubbed in `validate.ts`.
 *
 * With this setup a tamper that replaces the first character with `A` changes nothing, every run,
 * instead of one run in 64.
 */
import type * as NodeCrypto from 'node:crypto';
import { vi } from 'vitest';

export const FIXED_TOKEN_BYTE = 0x49;
const AUTH_TOKEN_BYTES = 16;

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  const randomBytes = ((size: number) =>
    size === AUTH_TOKEN_BYTES
      ? Buffer.alloc(size, FIXED_TOKEN_BYTE)
      : actual.randomBytes(size)) as typeof actual.randomBytes;
  return { ...actual, randomBytes };
});
