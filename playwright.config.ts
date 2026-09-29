import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end and accessibility testing (P02.05.04).
 *
 * The browser matrix is not symmetric on purpose. Chromium runs on every pull request because it
 * is the fastest signal; Firefox, WebKit and the phone viewport run nightly (QG-03), because
 * paying three extra browser runs on every push buys very little and slows the loop everyone
 * actually uses. WebKit matters regardless of its desktop share: it is Safari, and it is what a
 * Betriebsinhaber holds in their hand.
 *
 * The phone viewport is not a nicety either. The owner of a small business reads a missed-call
 * task between jobs, on a phone, one-handed — so that is a first-class target, not a degraded
 * desktop layout.
 */

const PR_ONLY = process.env['PLAYWRIGHT_FULL_MATRIX'] !== 'true';

export default defineConfig({
  testDir: './apps/web/e2e',
  // A stray `test.only` merged into main would silently skip the rest of the suite.
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  ...(process.env['CI'] === undefined ? {} : { workers: 2 }),
  reporter: process.env['CI'] !== undefined ? [['html', { open: 'never' }], ['list']] : 'list',

  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The owner app is German. A browser negotiating en-US would hide every localisation bug.
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(PR_ONLY
      ? []
      : [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
          { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
        ]),
  ],

  webServer: {
    // The standalone server is what the container actually runs. `next start` does not support
    // `output: standalone` and warns about it, so e2e would be exercising a different server
    // from production.
    command: 'node apps/web/.next/standalone/apps/web/server.js',
    url: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
    env: { PORT: '3000', HOSTNAME: '127.0.0.1' },
  },
});
