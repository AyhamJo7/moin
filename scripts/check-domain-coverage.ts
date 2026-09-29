/**
 * P03.02.06 — every entity the blueprint names is accounted for in the domain model.
 *
 * The failure this prevents is quiet: an entity in the founder's specification that nobody
 * translated into a module, noticed in P09 when something has nowhere to live. Reading two
 * documents side by side catches it the first time and not the fifth, so this does it mechanically.
 *
 * An entity may be accounted for by being modelled, or by being explicitly deferred — but not by
 * being absent.
 *
 *   node scripts/check-domain-coverage.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLUEPRINT = join(REPO_ROOT, 'BLUEPRINT.md');
const MODEL = join(REPO_ROOT, 'docs', 'architecture', 'domain-model.md');
const GLOSSARY = join(REPO_ROOT, 'docs', 'architecture', 'glossary.md');

/** The blueprint's data-model block, which PLAN cites for P03.02.02. */
const BLUEPRINT_RANGE = { start: 1028, end: 1087 } as const;

/**
 * Entities the blueprint names but the product defers, each with the phase that would build it.
 * Listed here rather than silently omitted: a deferred entity is a decision, an absent one is an
 * oversight, and the two must not look the same.
 */
const DEFERRED: Record<string, string> = {
  Document: 'P34 — document pipeline, deferred',
  Invoice: 'P34 — a structured projection of a document, deferred',
  Workflow: 'ADR-0027 — a bounded rule set, not a canvas; built in P10',
  WorkflowRun: 'P10, with the rule engine',
  Consent: 'P16, with the privacy module',
};

/**
 * Table-name plurals to try.
 *
 * Naive `+ s` reported `retention_policy` as unmapped because the table is `retention_policies` —
 * a false positive, and a false positive in a coverage check is worse than none: it teaches the
 * reader to skim the output.
 */
function pluralise(snake: string): string[] {
  if (/[^aeiou]y$/.test(snake)) return [`${snake.slice(0, -1)}ies`];
  if (/(s|x|z|ch|sh)$/.test(snake)) return [`${snake}es`];
  return [`${snake}s`];
}

/** CamelCase entity names inside the blueprint's tree diagrams. */
function blueprintEntities(): string[] {
  const lines = readFileSync(BLUEPRINT, 'utf8').split('\n');
  const block = lines.slice(BLUEPRINT_RANGE.start - 1, BLUEPRINT_RANGE.end).join('\n');
  const names = block.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) ?? [];
  // Prose words that are capitalised but are not entities.
  const notEntities = new Set([
    'Core',
    'Operational',
    'Governance',
    'Every',
    'Important',
    'PostgreSQL',
    'Row',
    'Level',
    'Security',
    'UUID',
    'NOT',
    'NULL',
  ]);
  return [...new Set(names.filter((n) => !notEntities.has(n)))].sort();
}

export interface DomainCoverage {
  readonly unmapped: string[];
  readonly deferred: string[];
  readonly checked: number;
}

export function coverage(): DomainCoverage {
  const model = readFileSync(MODEL, 'utf8') + readFileSync(GLOSSARY, 'utf8');
  const entities = blueprintEntities();

  const unmapped: string[] = [];
  const deferred: string[] = [];
  for (const entity of entities) {
    if (entity in DEFERRED) {
      deferred.push(`${entity} — ${DEFERRED[entity] ?? ''}`);
      continue;
    }
    // Mapped if it appears as a code term, or as its snake_case table name.
    const snake = entity.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    const forms = [entity, snake, ...pluralise(snake)];
    if (!forms.some((form) => model.includes(form))) {
      unmapped.push(entity);
    }
  }
  return { unmapped, deferred, checked: entities.length };
}

function main(): number {
  const result = coverage();
  if (result.unmapped.length > 0) {
    console.error('Entities in the blueprint with no place in the domain model:');
    for (const entity of result.unmapped) console.error(`  - ${entity}`);
    console.error(
      '\n  Either model it, or add it to DEFERRED in this script with the phase that builds it.\n' +
        '  A deferred entity is a decision; an absent one is an oversight (P03.02.06).',
    );
    return 1;
  }
  console.log(
    `domain coverage: ${String(result.checked)} blueprint entities, all accounted for ` +
      `(${String(result.deferred.length)} explicitly deferred).`,
  );
  for (const entry of result.deferred) console.log(`  deferred: ${entry}`);
  return 0;
}

process.exitCode = main();
