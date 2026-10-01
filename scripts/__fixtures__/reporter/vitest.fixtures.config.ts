import { defineConfig } from 'vitest/config';

/**
 * A config of its own, so these deliberately failing fixtures are never collected by `pnpm test`.
 *
 * They are named `*.fixture.ts` rather than `*.test.ts`, which the main config's `include` would
 * pick up. `mutation-reporter.integration.test.ts` runs this config as a child process and reads
 * the report the real reporter writes.
 */
export default defineConfig({
  test: {
    name: 'reporter-fixtures',
    root: process.cwd(),
    include: ['scripts/__fixtures__/reporter/*.fixture.ts'],
    // The same probe the real projects load, because the reporter's verdict depends on it.
    setupFiles: ['./scripts/mutation-evidence-probe.ts'],
    environment: 'node',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
