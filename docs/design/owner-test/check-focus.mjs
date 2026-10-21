// Focus regressions for the DG-10 owner-test prototype's simulated "Erledigt" (independent review
// finding I.1), against the real prototype.js in Chromium. Time is Playwright's fake clock, never
// a real sleep. Run from the repository root:
//   node docs/design/owner-test/check-focus.mjs
//
// An unrelated completion re-renders the task list. Keyboard focus that survives the re-render
// (navigation, skip link, another task's control, "Aktualisieren") must stay where it is; focus
// that was on the completed row's own control is recovered by the outcome notice.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(HERE, 'prototype', 'index.html')).href;
const PENDING_MS = 1200;
const KEY = 'dg10-prototype:';

const browser = await chromium.launch();
const failures = [];
let checks = 0;
const expect = (ok, what) => {
  checks += 1;
  if (!ok) failures.push(what);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Counts every non-empty message written into the outcome notice, per document.
const COUNT_NOTICES = () => {
  window.__notices = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const target = document.getElementById('meldung-text');
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes)
          if ((n.textContent ?? '').trim() !== '') window.__notices += 1;
      }
    }).observe(target, { childList: true, characterData: true, subtree: true });
  });
};

async function start(scenario = 'morgen') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-10-20T07:42:00Z') });
  await page.addInitScript(COUNT_NOTICES);
  await page.goto(`${PAGE}?szenario=${scenario}&neu=1`);
  return { ctx, page };
}

const button = (page, id) => page.locator(`[data-task-id="${id}"] button`);
const history = (page) =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]'), `${KEY}morgen:done`);
const notices = (page) => page.evaluate(() => window.__notices);
// Identity of the focused element: what it is, and whether it is still the very same node.
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el.tagName,
      id: el.id,
      text: (el.textContent ?? '').trim().slice(0, 40),
      key: el.dataset.focusKey ?? null,
      href: el.getAttribute('href'),
      task: el.closest('[data-task-id]')?.dataset.taskId ?? null,
      mark: el.__mark ?? null,
    };
  });
const mark = (page, selector) =>
  page.evaluate((s) => {
    document.querySelector(s).__mark = 'before';
  }, selector);

// Starts t101, puts focus on `target` (a locator), lets t101 complete, and returns focus before
// and after together with the completion record.
async function completeT101With(page, focusOn) {
  await button(page, 't101').click();
  await page.clock.runFor(300);
  await focusOn();
  const before = await focused(page);
  await page.clock.runFor(PENDING_MS - 300);
  return { before, after: await focused(page) };
}

// 1 and 2: navigation and skip link are outside the re-rendered region and keep focus, same node.
for (const [name, selector, text] of [
  ['1: "Heute"', 'nav a', 'Heute'],
  ['2: skip link', '.skip-link', 'Zum Inhalt springen'],
]) {
  const { ctx, page } = await start();
  await mark(page, selector);
  const { before, after } = await completeT101With(page, () => page.locator(selector).focus());
  expect(before.text === text, `${name}: focus starts on "${text}", got ${JSON.stringify(before)}`);
  expect(
    same(before, after),
    `${name}: focus stayed on the same node, before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  expect(after.id !== 'meldung', `${name}: the notice did not take focus`);
  expect(same(await history(page), ['t101']), `${name}: t101 recorded once`);
  expect((await notices(page)) === 1, `${name}: one announcement, got ${await notices(page)}`);
  await ctx.close();
}

// 3: another surviving task's controls keep focus (their nodes are replaced, matched by key).
for (const [name, locator] of [
  ['3a: t103 "Erledigt"', (page) => button(page, 't103')],
  ['3b: t102 call link', (page) => page.locator('[data-task-id="t102"] a.phone')],
]) {
  const { ctx, page } = await start();
  const { before, after } = await completeT101With(page, () => locator(page).focus());
  expect(before.task !== null, `${name}: focus starts in a task row`);
  expect(
    before.key === after.key && after.key !== null,
    `${name}: focus stayed on the same control, before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  expect(after.id !== 'meldung', `${name}: the notice did not take focus`);
  expect((await notices(page)) === 1, `${name}: one announcement, got ${await notices(page)}`);
  await ctx.close();
}

// 4: "Aktualisieren" keeps focus.
{
  const { ctx, page } = await start();
  const link = page.getByRole('link', { name: 'Aktualisieren' });
  const { before, after } = await completeT101With(page, () => link.focus());
  expect(
    before.key === 'refresh' && same(before, { ...after, mark: before.mark }),
    `4: focus stayed on "Aktualisieren", before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  await ctx.close();
}

// 5: focus on the completed row's own control is recovered by the notice, whichever control it was.
for (const [name, locator] of [
  ['5a: t101 "Erledigt"', (page) => button(page, 't101')],
  ['5b: t101 call link', (page) => page.locator('[data-task-id="t101"] a.phone')],
]) {
  const { ctx, page } = await start();
  const { before, after } = await completeT101With(page, () => locator(page).focus());
  expect(before.task === 't101', `${name}: focus starts in the t101 row`);
  expect(after.id === 'meldung', `${name}: the notice takes focus, got ${JSON.stringify(after)}`);
  expect((await notices(page)) === 1, `${name}: one announcement, got ${await notices(page)}`);
  await ctx.close();
}

// 6: overlapping completions never pull focus away from a surviving element.
for (const [name, focusOn, stays] of [
  ['6a: "Heute"', (page) => page.locator('nav a').focus(), (f) => f.text === 'Heute'],
  ['6b: t104 "Erledigt"', (page) => button(page, 't104').focus(), (f) => f.key === 't104:action'],
]) {
  const { ctx, page } = await start();
  await button(page, 't101').click();
  await page.clock.runFor(200);
  await button(page, 't102').click();
  await page.clock.runFor(200);
  await button(page, 't103').click();
  await focusOn(page);
  await page.clock.runFor(PENDING_MS); // t101 and t102 complete
  await page.clock.runFor(PENDING_MS); // t103 completes
  const after = await focused(page);
  expect(
    stays(after),
    `${name}: focus unchanged through three completions, got ${JSON.stringify(after)}`,
  );
  expect(
    same(await history(page), ['t101', 't102', 't103']),
    `${name}: history in completion order, got ${JSON.stringify(await history(page))}`,
  );
  expect((await notices(page)) === 3, `${name}: three announcements, got ${await notices(page)}`);
  await ctx.close();
}

// 6c: focus on a task's own control while it is the only one to complete, among overlaps: the
// notice takes it when that row leaves, and only then.
{
  const { ctx, page } = await start();
  await button(page, 't102').click();
  await page.clock.runFor(200);
  await button(page, 't103').click();
  await button(page, 't103').focus();
  await page.clock.runFor(PENDING_MS - 200); // t102 completes: focus on t103 is kept
  const mid = await focused(page);
  expect(
    mid.key === 't103:action',
    `6c: focus kept while t102 completes, got ${JSON.stringify(mid)}`,
  );
  await page.clock.runFor(200); // t103 completes: its row is gone
  expect((await focused(page)).id === 'meldung', '6c: the notice takes focus when t103 leaves');
  await ctx.close();
}

await browser.close();
for (const f of failures) console.error(`FAIL ${f}`);
console.log(`${checks} focus checks, ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
