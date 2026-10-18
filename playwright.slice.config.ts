import { defineConfig, devices } from '@playwright/test';

/**
 * The M1 vertical slice in a real browser: simulated call → callback task → Heute.
 *
 * Separate from `playwright.config.ts` because it needs the whole local stack: PostgreSQL and
 * Keycloak from `pnpm dev:up`, the `TEST_*` values from `.env.example` in the environment, and a
 * web build with the local API proxy (`OWNER_API_PROXY_ORIGIN=http://127.0.0.1:3101 pnpm --filter
 * @moin/web build`). The spec starts its own API process and owner-app server against a fresh
 * test database, so it never touches the development database. The pull-request e2e job has none
 * of those services, so this suite has its own CI job, `e2e-slice` in `verify.yml`; locally see
 * docs/development/m1-vertical-slice.md.
 *
 * One worker, no retries: the spec restarts the API mid-test and owns fixed ports.
 */
export default defineConfig({
  testDir: './e2e/vertical-slice',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  // In CI the JSON report lets `scripts/check-slice-report.ts` fail the job unless every required
  // acceptance test ran and passed (a skipped or missing test must not read as green).
  reporter:
    process.env['CI'] === undefined
      ? 'list'
      : [['list'], ['json', { outputFile: 'test-results/slice-report.json' }]],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
