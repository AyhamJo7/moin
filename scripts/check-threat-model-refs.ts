/**
 * Every checklist item the threat model cites must exist, and must plausibly be about the
 * mitigation it is attached to.
 *
 * This script exists because a review found the mapping wrong in roughly half its rows — webhook
 * signature validation pointed at the TwiML item, the tool guard pointed at PII redaction, the
 * audit append-only guarantee pointed at authentication abuse protection. Each ID looked
 * plausible and none had been resolved.
 *
 * That is worse than having no mapping. The document's own premise is that an item ID turns a
 * mitigation into a commitment; an ID that points somewhere else turns it into a commitment
 * nobody made, and it reads as rigour.
 *
 *   node scripts/check-threat-model-refs.ts
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THREAT_MODEL = join(REPO_ROOT, 'docs', 'security', 'threat-model.md');
const PLAN = join(REPO_ROOT, 'PLAN.md');

/** The last cell of a STRIDE row, which holds the item id. */
const ITEM_CELL = /\|\s*(P\d{2}\.\d{2}(?:\.\d{2})?)\s*\|\s*$/gm;

/** Words too common to indicate that a mitigation and an item are about the same thing. */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'per',
  'every',
  'each',
  'from',
  'into',
  'that',
  'this',
  'not',
  'are',
  'all',
  'any',
  'its',
  'via',
  'onto',
  'over',
  'plus',
  'test',
  'tests',
  'check',
  'checks',
  'never',
  'only',
  'must',
  'rather',
  'than',
  'their',
  'them',
  'when',
  'which',
  'what',
  'where',
]);

export interface Citation {
  readonly item: string;
  readonly mitigation: string;
}

export function citations(path: string = THREAT_MODEL): Citation[] {
  const text = readFileSync(path, 'utf8');
  const found: Citation[] = [];
  for (const line of text.split('\n')) {
    ITEM_CELL.lastIndex = 0;
    const match = ITEM_CELL.exec(line);
    if (match === null) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | STRIDE | threat | mitigation | item |
    found.push({ item: match[1] ?? '', mitigation: cells.at(-3) ?? '' });
  }
  return found;
}

/** The PLAN text for one checklist item, or undefined if it does not exist. */
function planText(item: string): string | undefined {
  try {
    const out = execFileSync('python3', ['.claude/bin/plan_section.py', item], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

export interface RefProblem {
  readonly item: string;
  readonly kind: 'missing' | 'unrelated';
  readonly mitigation: string;
  readonly planTitle?: string;
}

export function problems(path?: string): RefProblem[] {
  const out: RefProblem[] = [];
  const cache = new Map<string, string | undefined>();

  for (const { item, mitigation } of citations(path)) {
    if (!cache.has(item)) cache.set(item, planText(item));
    const text = cache.get(item);
    if (text === undefined) {
      out.push({ item, kind: 'missing', mitigation });
      continue;
    }
    // A shared keyword is a weak signal, and weak is the right strength here: the point is to
    // catch an id that is about something else entirely, not to grade the prose.
    const shared = [...keywords(mitigation)].filter((w) => keywords(text).has(w));
    if (shared.length === 0) {
      const title = /\*\*(P\d{2}\.\d{2}[^*]*)\*\*/.exec(text)?.[1];
      out.push({
        item,
        kind: 'unrelated',
        mitigation,
        ...(title === undefined ? {} : { planTitle: title }),
      });
    }
  }
  return out;
}

function main(): number {
  if (!readFileSync(PLAN, 'utf8').includes('INV-01')) {
    console.error('PLAN.md does not look like the plan; refusing to report a false pass.');
    return 2;
  }
  const found = problems();
  const all = citations();
  if (found.length === 0) {
    console.log(
      `threat model references: ${String(all.length)} cited items, all resolve and relate.`,
    );
    return 0;
  }
  for (const p of found) {
    console.error(
      p.kind === 'missing'
        ? `${p.item}: no such checklist item`
        : `${p.item}: is "${p.planTitle ?? 'unknown'}", which does not relate to "${p.mitigation.slice(0, 70)}"`,
    );
  }
  console.error(
    '\n  An item id that points somewhere else is worse than none: it turns a mitigation into a\n' +
      '  commitment nobody made, and it reads as rigour.',
  );
  return 1;
}

process.exitCode = main();
