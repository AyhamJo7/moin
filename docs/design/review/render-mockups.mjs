// Renders the UX-01 Gate 0 proposal mock-ups into images/ and checks them. Static files only: no
// application, no network. Run from the repository root: node docs/design/review/render-mockups.mjs
//
// Checks, every page and width: no horizontal scroll; WCAG text contrast of every visible text
// element; 44 x 44 px targets at least 8 px apart; on the Heute pages, the contracts DESIGN.md §5
// preserves; axe (WCAG 2.0-2.2 A/AA). Any failure exits non-zero and no image counts as reviewed.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 768, height: 1024 };
const PHONE = { width: 390, height: 844 };

const SHOTS = [
  ['foundations', [DESKTOP]],
  ['heute-populated', [DESKTOP, TABLET, PHONE]],
  ['heute-empty', [DESKTOP, PHONE]],
  ['heute-busy', [DESKTOP]],
  ['heute-actions', [DESKTOP, PHONE]],
  ['heute-states', [DESKTOP, PHONE]],
];
const SECTIONS = new Set([
  'Dringend',
  'Rückrufe',
  'Neue Anfragen',
  'Termine/Reservierungen zu bestätigen',
  'Offene Kundenfragen',
]);

// system-ui resolves to Roboto (what Android owners see) instead of the rendering machine's default.
const browser = await chromium.launch({
  env: { ...process.env, FONTCONFIG_FILE: path.join(HERE, 'fonts.conf') },
});
const failures = [];

for (const [name, viewports] of SHOTS) {
  for (const viewport of viewports) {
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

    const found = await page.evaluate(
      (heute) => {
        const out = [];
        // Collapse whitespace as an accessible name does; formatted HTML wraps long text.
        const text = (el) => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
        const rgb = (s) => s.match(/[\d.]+/g).map(Number);
        const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const shown = (el) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const ground = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor);
            if (c.length === 3 || c[3] === 1) return c.slice(0, 3);
            if (c[3] > 0) return null;
          }
          return [255, 255, 255];
        };
        if (document.documentElement.scrollWidth > innerWidth) out.push('scrolls horizontally');
        for (const el of document.body.querySelectorAll('*')) {
          if (!shown(el) || el.closest('.visually-hidden')) continue;
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const cs = getComputedStyle(el);
          const g = ground(el);
          const [hi, lo] = [lum(rgb(cs.color)), g ? lum(g) : NaN].sort((x, y) => y - x);
          const ratio = (hi + 0.05) / (lo + 0.05);
          const size = parseFloat(cs.fontSize);
          const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
          if (!(ratio >= need)) out.push(`contrast ${ratio.toFixed(2)}: "${text(el)}"`);
        }
        const targets = [...document.querySelectorAll('main a, main button, header a')]
          .filter(shown)
          .map((el) => ({ el, b: el.getBoundingClientRect() }));
        for (const [i, { el, b }] of targets.entries()) {
          const name = el.getAttribute('aria-label') ?? text(el);
          if (b.width < 44 || b.height < 44) out.push(`target ${b.width}x${b.height}: "${name}"`);
          for (const { b: o } of targets.slice(i + 1)) {
            const gap = Math.max(o.x - b.right, b.x - o.right, o.y - b.bottom, b.y - o.bottom);
            if (gap < 8) out.push(`targets closer than 8 px: "${name}"`);
          }
        }
        if (!heute) return out;
        if (text(document.querySelector('h1')) !== 'Heute') out.push('h1 is not "Heute"');
        for (const s of document.querySelectorAll('section[aria-labelledby]')) {
          const label = text(document.getElementById(s.getAttribute('aria-labelledby')));
          if (!heute.includes(label)) out.push(`region named "${label}"`);
          if (
            !s.querySelector('[data-task-id]') &&
            !/Alles erledigt\.|In dieser Auswahl keine\./u.test(text(s))
          )
            out.push(`empty region "${label}" without its empty line`);
        }
        for (const t of document.querySelectorAll('[data-task-id]')) {
          const title = text(t.querySelector('h3'));
          if (!text(t).includes('Offen')) out.push(`task "${title}" without "Offen"`);
          const button = t.querySelector('button');
          if (button && button.getAttribute('aria-label') !== `Erledigt: ${title}`)
            out.push(`button of "${title}" not named "Erledigt: ${title}"`);
          if (!button && !t.querySelector('[data-testid="complete-unavailable"]'))
            out.push(`task "${title}" has neither "Erledigt" nor the unavailable line`);
          const call = t.querySelector('a[href^="tel:"]');
          if (call && text(call) !== call.getAttribute('href').slice(4))
            out.push(`call link of "${title}" not named by the number`);
          if (!t.querySelector('time[datetime]')) out.push(`task "${title}" without <time>`);
        }
        return out;
      },
      name.startsWith('heute-') ? [...SECTIONS] : null,
    );

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const v of axe.violations) found.push(`axe ${v.id} (${v.impact}) ${v.nodes[0]?.target}`);

    await page.screenshot({ path: path.join(HERE, 'images', `${id}.png`), fullPage: true });
    for (const f of found) failures.push(`${id}: ${f}`);
    console.log(`${found.length === 0 ? 'ok  ' : 'FAIL'} ${id}`);
    await ctx.close();
  }
}
await browser.close();
for (const f of failures) console.error(f);
process.exit(failures.length === 0 ? 0 : 1);
