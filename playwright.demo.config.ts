import { defineConfig, devices } from '@playwright/test';

/**
 * Browser acceptance of the packaged demo stack (M2D-2): the real API image, the real owner-app
 * image, PostgreSQL and Keycloak, started by `deploy/demo/demo.sh up`. Unlike the slice suite
 * (`playwright.slice.config.ts`), which starts its own processes from a developer build, this one
 * starts nothing: it drives what is already running at http://localhost:3000, and it restarts
 * services only through `demo.sh`. See docs/development/demo-stack.md.
 *
 * One worker and no retries: the tests are one story and restart the stack.
 */
export default defineConfig({
  testDir: './e2e/packaged-demo',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
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
