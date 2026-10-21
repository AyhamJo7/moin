// Renders the UX-01 Gate 0 proposal mock-ups into images/ and checks them. Static files only: no
// application, no network. Run from the repository root: node docs/design/review/render-mockups.mjs
// (add --check to run the checks without writing images)
//
// Checks (checks.mjs), every page and width from 320 to 1440 px: no horizontal scroll; WCAG text
// contrast; 44 x 44 px targets at least 8 px apart; visible labels inside accessible names; nothing
// in a task row covering anything else; on the Heute pages, the contracts DESIGN.md §5 preserves;
// axe (WCAG 2.0-2.2 A/AA). Any failure exits non-zero and no image counts as reviewed.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { axe, inspect } from './checks.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
// --check: run every check, write no image (for regression and mutation runs).
const CHECK_ONLY = process.argv.includes('--check');
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 768, height: 1024 };
const PHONE = { width: 390, height: 844 };
// Checked, not saved: the narrowest phones (WCAG 1.4.10 reflow at 320 px) and 1280 px desktop.
const NARROW = { width: 320, height: 640, save: false };
const SMALL = { width: 360, height: 740, save: false };
const LAPTOP = { width: 1280, height: 800, save: false };

const SHOTS = [
  ['foundations', [DESKTOP]],
  ['heute-populated', [DESKTOP, LAPTOP, TABLET, PHONE, SMALL, NARROW]],
  ['heute-empty', [DESKTOP, PHONE, NARROW]],
  ['heute-busy', [DESKTOP, SMALL, NARROW]],
  ['heute-actions', [DESKTOP, { ...TABLET, save: false }, PHONE, SMALL, NARROW]],
  ['heute-states', [DESKTOP, PHONE, NARROW]],
];

// system-ui resolves to Roboto (what Android owners see) instead of the rendering machine's default.
const browser = await chromium.launch({
  env: { ...process.env, FONTCONFIG_FILE: path.join(HERE, 'fonts.conf') },
});
const failures = [];

for (const [name, viewports] of SHOTS) {
  for (const { save = true, ...viewport } of viewports) {
    const id = `${name}-${viewport.width}`;
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(HERE, 'mockups', `${name}.html`)).href);
    const found = [
      ...(await inspect(page, { heute: name.startsWith('heute-') })),
      ...(await axe(page)),
    ];
    if (save && !CHECK_ONLY) {
      await page.screenshot({ path: path.join(HERE, 'images', `${id}.png`), fullPage: true });
    }
    for (const f of found) failures.push(`${id}: ${f}`);
    console.log(
      `${found.length === 0 ? 'ok  ' : 'FAIL'} ${id}${save ? '' : ' (checked, not saved)'}`,
    );
    await ctx.close();
  }
}
await browser.close();
for (const f of failures) console.error(f);
process.exit(failures.length === 0 ? 0 : 1);
