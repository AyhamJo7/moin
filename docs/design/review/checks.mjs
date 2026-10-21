// Page checks shared by render-mockups.mjs and the DG-10 owner-test prototype check. Static
// pages only. Each check returns a list of failure strings; an empty list means the page passed.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { default: AxeBuilder } = require('@axe-core/playwright');

export const SECTIONS = [
  'Dringend',
  'Rückrufe',
  'Neue Anfragen',
  'Termine/Reservierungen zu bestätigen',
  'Offene Kundenfragen',
];

/**
 * Layout, contrast, target and contract checks in the page. `heute` turns on the Heute contracts
 * DESIGN.md §5 preserves (h1, region names, "Offen", button and call-link names, `<time>`, the
 * empty line of an empty region).
 */
export function inspect(page, { heute }) {
  return page.evaluate(
    ({ heute, sections }) => {
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
      const overlap = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

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
        // WCAG 2.5.3: the visible label is part of the accessible name.
        const label = el.getAttribute('aria-label');
        if (label !== null && !label.includes(text(el)))
          out.push(`visible label "${text(el)}" is not in the name "${label}"`);
      }

      // Nothing inside a task row covers anything else in it, at any width.
      for (const article of document.querySelectorAll('[data-task-id] > article')) {
        const parts = [...article.children].filter(shown).map((el) => ({
          el,
          b: el.getBoundingClientRect(),
        }));
        for (const [i, a] of parts.entries()) {
          for (const c of parts.slice(i + 1)) {
            if (overlap(a.b, c.b))
              out.push(
                `"${a.el.className}" overlaps "${c.el.className}" in "${text(article.querySelector('h3'))}"`,
              );
          }
        }
      }

      if (!heute) return out;
      if (text(document.querySelector('h1')) !== 'Heute') out.push('h1 is not "Heute"');
      for (const s of document.querySelectorAll('section[aria-labelledby]')) {
        const label = text(document.getElementById(s.getAttribute('aria-labelledby')));
        if (!sections.includes(label)) out.push(`region named "${label}"`);
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
        const name =
          button?.getAttribute('aria-busy') === 'true' ? 'Wird gespeichert …' : 'Erledigt';
        if (button && button.getAttribute('aria-label') !== `${name}: ${title}`)
          out.push(`button of "${title}" not named "${name}: ${title}"`);
        if (!button && !t.querySelector('[data-testid="complete-unavailable"]'))
          out.push(`task "${title}" has neither "Erledigt" nor the unavailable line`);
        const call = t.querySelector('a[href^="tel:"]');
        if (call && text(call) !== call.getAttribute('href').slice(4))
          out.push(`call link of "${title}" not named by the number`);
        if (!t.querySelector('time[datetime]')) out.push(`task "${title}" without <time>`);
      }
      return out;
    },
    { heute, sections: SECTIONS },
  );
}

/** axe with the WCAG 2.0-2.2 A/AA tags; one failure string per violated rule. */
export async function axe(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations.map((v) => `axe ${v.id} (${v.impact}) ${v.nodes[0]?.target}`);
}
