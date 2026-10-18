import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The signature tests with a fixed auth token whose signature starts with `A`, so the
 * "tampered signature" test runs on the awkward input every time (see the setup file). Run from
 * the repository root:
 *
 *   pnpm exec vitest run -c packages/telephony/test-support/fixed-auth-token.vitest.config.ts
 *
 * It re-runs `validate.test.ts` unchanged plus a premise check, and is the regression command for
 * the official mutation check of the tamper-test repair (the repaired test file is what that check
 * reverses, so the discriminator has to live outside it).
 */
export default defineConfig({
  test: {
    name: 'telephony-fixed-auth-token',
    root: resolve(import.meta.dirname, '../../..'),
    include: [
      'packages/telephony/src/signature/validate.test.ts',
      'packages/telephony/test-support/fixed-auth-token.test.ts',
    ],
    setupFiles: [resolve(import.meta.dirname, 'fixed-auth-token.setup.ts')],
    env: { FIXED_AUTH_TOKEN_RUN: '1' },
    environment: 'node',
  },
});
