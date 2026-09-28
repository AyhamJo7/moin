/**
 * P03.04.03 — every personal-data flow in the DFD maps to an inventory category and a
 * subprocessor entry.
 *
 * A data-flow diagram is a compliance artefact: it feeds the TOMs, the DPIA and the subprocessor
 * register. Its failure mode is silent drift — a flow added in P20 that the diagram never gains,
 * or a category named in the diagram that the inventory does not define. Either makes the register
 * wrong, and nothing says so.
 *
 *   node scripts/check-dfd-coverage.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DFD = join(REPO_ROOT, 'docs', 'architecture', 'data-flow.md');
const INVENTORY = join(REPO_ROOT, 'docs', 'privacy', 'data-inventory.md');

/** A flow row: | **F1** | description | personal data | category | guard | */
const FLOW_ROW = /^\|\s*\*\*(F\d+)\*\*\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;

export interface Flow {
  readonly id: string;
  readonly categories: string[];
  readonly guard: string;
}

export function flows(dfdPath: string = DFD): Flow[] {
  const text = readFileSync(dfdPath, 'utf8');
  return [...text.matchAll(FLOW_ROW)].map((m) => ({
    id: m[1] ?? '',
    categories: (m[4] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/`/g, ''))
      // `all` is not a classification. A flow that touches everything must say what everything
      // is, or the register cannot be derived from it.
      .filter((c) => c.length > 0 && c !== '—'),
    guard: (m[5] ?? '').trim(),
  }));
}

export interface DfdCoverage {
  readonly withoutCategory: string[];
  readonly withoutGuard: string[];
  readonly unknownCategory: string[];
  readonly checked: number;
}

export function coverage(dfdPath?: string, inventoryPath: string = INVENTORY): DfdCoverage {
  const inventory = readFileSync(inventoryPath, 'utf8');
  const all = flows(dfdPath);
  return {
    // A flow with no category is one nobody classified.
    withoutCategory: all.filter((f) => f.categories.length === 0).map((f) => f.id),
    // A crossing with no guard is a crossing nobody defended.
    withoutGuard: all.filter((f) => f.guard.length === 0).map((f) => f.id),
    // A category the inventory does not define makes the register wrong.
    unknownCategory: all
      .flatMap((f) => f.categories.map((c) => ({ id: f.id, c })))
      // A flow may carry something that is not personal data at all — a credential, say — and
      // that is a classification too, as long as it says so.
      .filter(({ c }) => !c.includes('not personal data') && !inventory.includes(c))
      .map(({ id, c }) => `${id}: ${c}`),
    checked: all.length,
  };
}

function main(): number {
  const result = coverage();
  let failed = false;
  for (const [label, items] of [
    ['flows with no inventory category', result.withoutCategory],
    ['flows with no guard at the boundary', result.withoutGuard],
    ['categories the inventory does not define', result.unknownCategory],
  ] as const) {
    if (items.length > 0) {
      failed = true;
      console.error(`${label}:`);
      for (const item of items) console.error(`  - ${item}`);
    }
  }
  if (failed) {
    console.error(
      '\n  The diagram feeds the TOMs, the DPIA and the subprocessor register. A flow the\n' +
        '  inventory does not know about makes all three wrong, silently (P03.04.03).',
    );
    return 1;
  }
  console.log(
    `DFD coverage: ${String(result.checked)} flows, each with an inventory category and a guard.`,
  );
  return 0;
}

process.exitCode = main();
