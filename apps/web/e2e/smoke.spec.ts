import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The example end-to-end test (P02.05.04, P02.05.06).
 *
 * Deliberately thin: the owner app is P13. What this proves now is that the harness works — the
 * server starts, a browser reaches it, and the accessibility scan runs and can fail. A harness
 * whose first real use is also its first run is a harness nobody trusts when it goes red.
 */

test.describe('web smoke', () => {
  test('serves the home route', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('declares German as the document language', async ({ page }) => {
    await page.goto('/');
    // Not cosmetic: a screen reader picks its pronunciation from this attribute, so a German
    // page marked `en` is read out in an English voice.
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });

  test('sets the baseline security headers', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('has no automatically detectable WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    // Automated checks catch roughly a third of real accessibility problems; the manual
    // keyboard and screen-reader pass per release (QG-03) covers the rest. Zero here is a floor,
    // not a certificate.
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toStrictEqual([]);
  });
});
