import { defineConfig } from 'vitest/config';

/**
 * Vitest projects (P02.05.01).
 *
 * `unit` and `integration` are separate projects rather than a naming convention, because they
 * have genuinely different requirements. Integration tests need a running Postgres and a private
 * database per file, so they cannot share the unit project's timeouts, concurrency or setup. One
 * project for both would mean either slowing every unit test to integration settings, or running
 * integration tests under settings that make them flaky — and a flaky integration test is one that
 * gets quarantined and then deleted.
 *
 *   pnpm test              unit only; no Docker needed
 *   pnpm test:integration  needs `pnpm dev:up`
 */
export default defineConfig({
  test: {
    // A test that hangs should fail, not stall CI until the job timeout.
    testTimeout: 10_000,
    hookTimeout: 20_000,
    reporters: process.env['CI'] === undefined ? ['default'] : ['default', 'junit'],
    outputFile: { junit: './test-results/junit.xml' },

    projects: [
      {
        test: {
          name: 'unit',
          root: import.meta.dirname,
          // The mutation harness's in-process assertion probe (P06.10.07). Loaded for every run,
          // not only the sweep's, so that the sweep measures tests exactly as CI runs them — a
          // harness that changes the thing it measures is not measuring it.
          setupFiles: ['./scripts/mutation-assertion-probe.ts'],
          include: ['{apps,packages,scripts}/**/*.test.ts', '{apps,packages}/**/*.test.tsx'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.next/**',
            '**/*.integration.test.ts',
            '**/e2e/**',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          root: import.meta.dirname,
          setupFiles: ['./scripts/mutation-assertion-probe.ts'],
          include: ['{apps,packages,scripts}/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'node',
          // Each file gets its own database cloned from the template, so files are independent
          // and can run in parallel. The limit is the connection budget, not correctness.
          fileParallelism: true,
          maxConcurrency: 4,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['./packages/testing/src/pg/global-setup.ts'],
        },
      },
    ],
  },
});
