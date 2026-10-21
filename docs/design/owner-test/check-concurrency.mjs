// Concurrency regressions for the DG-10 owner-test prototype's simulated "Erledigt", against the
// real prototype.js in Chromium. Time is Playwright's fake clock, never a real sleep, so every
// run is deterministic. Run from the repository root:
//   node docs/design/owner-test/check-concurrency.mjs
//
// Each case is named after the remediation brief (A–N). The completion history is the
// prototype's own record in sessionStorage; announcements are counted from the outcome notice.
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

async function start(scenario) {
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

const history = (page, scenario = 'morgen') =>
  page.evaluate(
    ([key]) => JSON.parse(sessionStorage.getItem(key) ?? '[]'),
    [`${KEY}${scenario}:done`],
  );
const notices = (page) => page.evaluate(() => window.__notices);
const button = (page, id) => page.locator(`[data-task-id="${id}"] button`);
const rows = (page) =>
  page.locator('[data-task-id]').evaluateAll((els) => els.map((e) => e.dataset.taskId));
const state = (page, id) =>
  button(page, id).evaluate((b) => ({
    busy: b.getAttribute('aria-busy'),
    disabled: b.getAttribute('aria-disabled'),
    name: b.getAttribute('aria-label'),
    text: b.textContent.trim(),
  }));
const isPending = async (page, id, title) => {
  const s = await state(page, id);
  return (
    s.busy === 'true' &&
    s.disabled === 'true' &&
    s.text === 'Wird gespeichert …' &&
    s.name === `Wird gespeichert …: ${title}`
  );
};

// A–F: two completions started 300 ms apart; the first one's re-render must not reset the second.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't101').click();
  await page.clock.runFor(300);
  await button(page, 't102').click();
  await page.clock.runFor(PENDING_MS - 300); // t101 completes, the list re-renders
  expect(
    same(await rows(page), ['t102', 't103', 't104']),
    'B: t101 left the list, the rest stayed',
  );
  expect(
    await isPending(page, 't102', 'Rückruf: Reservierung'),
    'C: t102 is still pending after the re-render',
  );
  await button(page, 't102').click({ force: true }); // D: the replacement node is activated again
  await page.clock.runFor(PENDING_MS);
  expect(
    same(await history(page), ['t101', 't102']),
    `E: one entry per task, got ${JSON.stringify(await history(page))}`,
  );
  expect((await notices(page)) === 2, `F: two announcements, got ${await notices(page)}`);
  await ctx.close();
}

// G: rapid repeated activation of one task, by pointer and keyboard.
{
  const { ctx, page } = await start('morgen');
  for (let i = 0; i < 3; i += 1) await button(page, 't103').click({ force: true });
  await button(page, 't103').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.clock.runFor(PENDING_MS * 2);
  expect(
    same(await history(page), ['t103']),
    `G: one completion, got ${JSON.stringify(await history(page))}`,
  );
  expect((await notices(page)) === 1, `G: one announcement, got ${await notices(page)}`);
  await ctx.close();
}

// H: three concurrent completions, started out of list order; each stays pending until its own end.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't104').click();
  await page.clock.runFor(200);
  await button(page, 't102').click();
  await page.clock.runFor(200);
  await button(page, 't103').click();
  await page.clock.runFor(PENDING_MS - 400); // t104 done
  expect(await isPending(page, 't102', 'Rückruf: Reservierung'), 'H: t102 pending after t104');
  expect(await isPending(page, 't103', 'Rückruf: Geburtstagsfeier'), 'H: t103 pending after t104');
  await page.clock.runFor(200); // t102 done
  expect(await isPending(page, 't103', 'Rückruf: Geburtstagsfeier'), 'H: t103 pending after t102');
  await page.clock.runFor(200); // t103 done
  expect(
    same(await history(page), ['t104', 't102', 't103']),
    `H: history in completion order, got ${JSON.stringify(await history(page))}`,
  );
  expect(same(await rows(page), ['t101']), 'H: the untouched urgent task remains');
  expect((await notices(page)) === 3, `H: three announcements, got ${await notices(page)}`);
  await ctx.close();
}

// I: a new scenario is started (moderator link, same tab) while a completion is pending.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't102').click();
  await page.clock.runFor(300);
  await page.goto(`${PAGE}?szenario=voll&neu=1`);
  await page.clock.runFor(PENDING_MS * 2);
  expect(same(await history(page, 'morgen'), []), 'I: the old scenario recorded nothing');
  expect(same(await history(page, 'voll'), []), 'I: the new scenario recorded nothing');
  expect((await rows(page)).length === 10, 'I: the new scenario shows all ten tasks');
  expect((await notices(page)) === 0, 'I: nothing was announced');
  await ctx.close();
}

// J: the session is reset while an old completion is still scheduled in a live document (as when
// a page comes back from the back/forward cache). The reset is done exactly as a ?neu=1 load does
// it: every prototype key is cleared and a new session marker is written.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't102').click();
  await page.clock.runFor(300);
  await page.evaluate((key) => {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith(key)) sessionStorage.removeItem(k);
    sessionStorage.setItem(`${key}session`, JSON.stringify('after-reset'));
  }, KEY);
  await page.clock.runFor(PENDING_MS * 2);
  expect(
    same(await history(page), []),
    `J: a stale callback wrote ${JSON.stringify(await history(page))} into the reset session`,
  );
  expect(
    (await notices(page)) === 0,
    `J: a stale callback announced ${await notices(page)} completion(s)`,
  );
  await ctx.close();
}

// K: "Aktualisieren" while a completion is pending abandons it (the documented semantics: a
// reload during "Wird gespeichert …" cancels the simulated request), and nothing completes later.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't101').click();
  await page.clock.runFor(PENDING_MS + 10); // t101 done
  await button(page, 't102').click();
  await page.clock.runFor(300);
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('link', { name: 'Aktualisieren' }).click(),
  ]);
  await page.clock.runFor(PENDING_MS * 2);
  expect(
    same(await history(page), ['t101']),
    `K: only t101 is done, got ${JSON.stringify(await history(page))}`,
  );
  expect(
    same(await rows(page), ['t102', 't103', 't104']),
    'K: t101 stays done, t102 is open again',
  );
  expect((await state(page, 't102')).busy !== 'true', 'K: t102 is no longer pending');
  await button(page, 't102').click();
  await page.clock.runFor(PENDING_MS);
  expect(same(await history(page), ['t101', 't102']), 'K: t102 can then be completed once');
  await ctx.close();
}

// L: a full browser reload keeps completed tasks and abandons pending ones.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't103').click();
  await page.clock.runFor(PENDING_MS + 10);
  await button(page, 't104').click();
  await page.reload();
  await page.clock.runFor(PENDING_MS * 2);
  expect(
    same(await history(page), ['t103']),
    `L: reload keeps t103 only, got ${JSON.stringify(await history(page))}`,
  );
  expect(
    same(await rows(page), ['t101', 't102', 't104']),
    'L: t104 is open again after the reload',
  );
  await ctx.close();
}

// M: keyboard activation, pending labels, other tasks stay usable, focus stays predictable.
{
  const { ctx, page } = await start('morgen');
  await button(page, 't102').focus();
  await page.keyboard.press('Enter');
  expect(
    await isPending(page, 't102', 'Rückruf: Reservierung'),
    'M: Enter starts the pending state',
  );
  await page.clock.runFor(300);
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => document.activeElement.getAttribute('href'));
  expect(next === 'tel:+493000000103', `M: Tab moves on to the next task's call link, got ${next}`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  expect(
    await isPending(page, 't103', 'Rückruf: Geburtstagsfeier'),
    'M: a second task can start while the first is pending',
  );
  await page.clock.runFor(PENDING_MS - 250); // t102 done at 1200, t103 pending until 1500
  const focus = await page.evaluate(() => ({
    task: document.activeElement.closest('[data-task-id]')?.dataset.taskId ?? null,
    id: document.activeElement.id,
  }));
  expect(
    focus.task === 't103',
    `M: focus stays on t103's control while t102 completes, got ${JSON.stringify(focus)}`,
  );
  await page.clock.runFor(300); // t103 done: its row is gone
  const after = await page.evaluate(() => document.activeElement.id);
  expect(
    after === 'meldung',
    `M: focus moves to the notice when its own row leaves, got "${after}"`,
  );
  expect((await notices(page)) === 2, `M: two announcements, got ${await notices(page)}`);
  await ctx.close();
}

// N: unavailable, empty and error scenarios are unchanged by the completion machinery.
{
  const { ctx, page } = await start('nicht-moeglich');
  await button(page, 't101').click();
  await page.clock.runFor(PENDING_MS + 10);
  expect((await button(page, 't102').count()) === 0, 'N: t102 stays unavailable after a re-render');
  expect(
    await page.locator('[data-task-id="t102"] [data-testid="complete-unavailable"]').isVisible(),
    'N: unavailable line shown',
  );
  expect(same(await history(page, 'nicht-moeglich'), ['t101']), 'N: only t101 completed');
  await page.goto(`${PAGE}?szenario=leer&neu=1`);
  expect((await page.locator('button').count()) === 0, 'N: the empty scenario has no action');
  await page.goto(`${PAGE}?szenario=fehler&neu=1`);
  expect(await page.getByRole('alert').isVisible(), 'N: the error scenario shows its alert');
  expect((await page.locator('[data-task-id]').count()) === 0, 'N: no task under the error');
  await ctx.close();
}

await browser.close();
for (const f of failures) console.error(`FAIL ${f}`);
console.log(`${checks} concurrency checks, ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
