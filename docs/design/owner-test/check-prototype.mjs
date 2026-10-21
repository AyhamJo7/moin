// Checks the DG-10 owner-test prototype in Chromium, from local files only. Run from the repository
// root: node docs/design/owner-test/check-prototype.mjs
//
// 1. Every scenario at 320-1440 px, plus the 200% zoom equivalents (640 and 720 px CSS width for a
//    1280 and 1440 px window) and 200% phone text size: layout, contrast, targets, labels, row
//    overlap, Heute contracts and axe (../review/checks.mjs).
// 2. Scripted interactions: keyboard order and visible focus, completing a task (pending state,
//    no double activation, row removed, notice focused), state across "Aktualisieren" and reset,
//    all done -> empty, loading, error -> reload, unavailable action, reduced motion, no network.
// Passing says the prototype behaves as designed. It says nothing about the real application, and
// nothing about screen-reader usability, which needs a person (README.md).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { axe, inspect } from '../review/checks.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(HERE, 'prototype', 'index.html')).href;
const MODERATOR = pathToFileURL(path.join(HERE, 'prototype', 'moderator.html')).href;
const PENDING_MS = 1200;
const LOADING_MS = 1800;
const WIDTHS = [320, 360, 390, 640, 720, 768, 1280, 1440];
const SCENARIOS = ['morgen', 'voll', 'leer', 'laden', 'fehler', 'nicht-moeglich'];

const browser = await chromium.launch({
  env: { ...process.env, FONTCONFIG_FILE: path.join(HERE, '..', 'review', 'fonts.conf') },
});
const failures = [];
let checks = 0;
const expect = (ok, what) => {
  checks += 1;
  if (!ok) failures.push(what);
};

async function open(width, scenario, { fresh = true, height = 900, textScale = 1 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${PAGE}?szenario=${scenario}${fresh ? '&neu=1' : ''}`);
  if (textScale !== 1) {
    // Phone "text size" settings scale text, not the layout viewport (CSSOM, so the CSP allows it).
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`;
    }, textScale);
  }
  return { ctx, page, requests, errors };
}

const settle = async (page, scenario) => {
  if (scenario === 'laden') await page.waitForTimeout(LOADING_MS + 300);
};

// --- 1. layout and accessibility, every scenario and width ---------------------------------
for (const scenario of SCENARIOS) {
  for (const width of WIDTHS) {
    const { ctx, page, requests, errors } = await open(width, scenario);
    await settle(page, scenario);
    // Console errors are taken before axe runs: axe fetches the stylesheets to analyse them, which
    // the page's own CSP (connect-src 'none') rightly blocks.
    const pageErrors = [...errors];
    const found = [...(await inspect(page, { heute: true })), ...(await axe(page))];
    for (const f of found) failures.push(`${scenario}@${width}: ${f}`);
    expect(
      pageErrors.length === 0,
      `${scenario}@${width}: console errors ${pageErrors.join(' | ')}`,
    );
    expect(
      requests.every((u) => u.startsWith('file:')),
      `${scenario}@${width}: a request left the device: ${requests.filter((u) => !u.startsWith('file:'))}`,
    );
    checks += 1;
    await ctx.close();
  }
}
for (const width of [360, 390]) {
  const { ctx, page } = await open(width, 'voll', { textScale: 2 });
  for (const f of await inspect(page, { heute: true }))
    failures.push(`voll@${width} text 200%: ${f}`);
  checks += 1;
  await ctx.close();
}
{
  const { ctx, page } = await open(1440, 'morgen');
  await page.goto(MODERATOR);
  for (const f of [...(await inspect(page, { heute: false })), ...(await axe(page))])
    failures.push(`moderator@1440: ${f}`);
  checks += 1;
  await ctx.close();
}

// --- 2. interactions -----------------------------------------------------------------------
const focusName = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const outline = parseFloat(getComputedStyle(el).outlineWidth);
    const name = el.getAttribute('aria-label') ?? el.textContent.replace(/\s+/gu, ' ').trim();
    return { name, outline };
  });

for (const width of [390, 1440]) {
  // Keyboard order and visible focus (DESIGN.md §7).
  {
    const { ctx, page } = await open(width, 'morgen');
    const expected = [
      'Zum Inhalt springen',
      'Heute',
      'Aktualisieren',
      '+493000000101',
      'Erledigt: Rückruf erbeten',
      '+493000000102',
      'Erledigt: Rückruf: Reservierung',
      '+493000000103',
      'Erledigt: Rückruf: Geburtstagsfeier',
      '+493000000104',
      'Erledigt: Rückruf: Reservierung für Geburtstagsfeier',
    ];
    for (const want of expected) {
      await page.keyboard.press('Tab');
      const { name, outline } = await focusName(page);
      expect(name === want, `@${width} tab order: expected "${want}", got "${name}"`);
      expect(outline >= 3, `@${width} focus on "${name}" has a ${outline}px outline`);
    }
    await ctx.close();
  }

  // Completing a task with the keyboard.
  {
    const { ctx, page } = await open(width, 'morgen');
    const button = page.locator('[data-task-id="t102"] button');
    await button.focus();
    await page.keyboard.press('Enter');
    expect((await button.getAttribute('aria-busy')) === 'true', `@${width} pending: aria-busy`);
    expect(
      (await button.getAttribute('aria-label')) === 'Wird gespeichert …: Rückruf: Reservierung',
      `@${width} pending: accessible name carries the visible label`,
    );
    expect((await button.textContent()).trim() === 'Wird gespeichert …', `@${width} pending label`);
    for (const f of await inspect(page, { heute: true }))
      failures.push(`morgen@${width} pending: ${f}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(PENDING_MS + 300);
    expect(
      (await page.locator('[data-task-id="t102"]').count()) === 0,
      `@${width} row left the list`,
    );
    expect(
      (await page.locator('[data-task-id]').count()) === 3,
      `@${width} the other three remain`,
    );
    const notice = page.getByTestId('action-notice');
    expect(
      (await notice.textContent()).trim() === 'Der Rückruf ist als erledigt markiert.',
      `@${width} notice text`,
    );
    expect(
      (await page.evaluate(() => document.activeElement.id)) === 'meldung',
      `@${width} focus moved to the notice`,
    );
    expect(
      (
        await page
          .getByRole('region', { name: 'Rückrufe', exact: true })
          .locator('.count')
          .textContent()
      ).startsWith('2'),
      `@${width} Rückrufe count is 2`,
    );

    // "Aktualisieren" keeps the completion; a fresh start restores it.
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('link', { name: 'Aktualisieren' }).click(),
    ]);
    expect(
      (await page.locator('[data-task-id]').count()) === 3,
      `@${width} still done after Aktualisieren`,
    );
    await page.goto(`${PAGE}?szenario=morgen&neu=1`);
    expect(
      (await page.locator('[data-task-id]').count()) === 4,
      `@${width} reset restores all four`,
    );
    expect(!page.url().includes('neu='), `@${width} reset link leaves a reload-safe URL`);

    // Completing everything leaves every section empty.
    for (let n = 0; n < 4; n += 1) {
      await page.locator('[data-task-id] button').first().click();
      await page.waitForTimeout(PENDING_MS + 200);
    }
    expect((await page.locator('[data-task-id]').count()) === 0, `@${width} all done`);
    expect((await page.getByText('Alles erledigt.').count()) === 5, `@${width} five empty lines`);
    for (const f of await inspect(page, { heute: true }))
      failures.push(`morgen@${width} all done: ${f}`);
    await ctx.close();
  }

  // Loading, then the list.
  {
    const { ctx, page } = await open(width, 'laden');
    expect(
      await page.getByRole('status').filter({ hasText: 'Aufgaben werden geladen …' }).isVisible(),
      `@${width} loading text`,
    );
    expect(
      (await page.locator('[data-task-id]').count()) === 0,
      `@${width} no tasks while loading`,
    );
    await page.waitForTimeout(LOADING_MS + 300);
    expect((await page.locator('[data-task-id]').count()) === 4, `@${width} list after loading`);
    await ctx.close();
  }

  // Error, then "Neu laden".
  {
    const { ctx, page } = await open(width, 'fehler');
    expect(await page.getByRole('alert').isVisible(), `@${width} error alert`);
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('link', { name: 'Neu laden' }).click(),
    ]);
    expect((await page.locator('[data-task-id]').count()) === 4, `@${width} list after Neu laden`);
    await ctx.close();
  }

  // Unavailable action.
  {
    const { ctx, page } = await open(width, 'nicht-moeglich');
    const row = page.locator('[data-task-id="t102"]');
    expect((await row.locator('button').count()) === 0, `@${width} no Erledigt when unavailable`);
    expect(await row.getByTestId('complete-unavailable').isVisible(), `@${width} unavailable line`);
    await ctx.close();
  }

  // Reduced motion: nothing animates (the prototype has no transitions at all).
  {
    const { ctx, page } = await open(width, 'voll');
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el);
          return parseFloat(cs.transitionDuration) > 0 || parseFloat(cs.animationDuration) > 0;
        }).length,
    );
    expect(moving === 0, `@${width} ${moving} element(s) animate under reduced motion`);
    await ctx.close();
  }
}

await browser.close();
for (const f of failures) console.error(`FAIL ${f}`);
console.log(`${checks} checks, ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
