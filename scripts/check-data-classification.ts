/**
 * P03.06.04 / QG-12 — no column holding personal data is unclassified.
 *
 * The inventory is only useful if it stays true. A column added in P07 that nobody classified is
 * exactly the column an erasure request will miss, and it will be missed silently: nothing fails,
 * the data simply survives a deletion that was reported as complete.
 *
 * So this compares the schema against the inventory and fails on anything the inventory has not
 * seen. Today it reads the migrations; once Drizzle table definitions exist (P06) it reads those,
 * which is stricter because it sees types.
 *
 *   node scripts/check-data-classification.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(REPO_ROOT, 'packages', 'db', 'migrations');
const INVENTORY = join(REPO_ROOT, 'docs', 'privacy', 'data-inventory.md');

/**
 * Columns that are structural rather than data: keys, timestamps, tenant scope, bookkeeping.
 *
 * Deliberately narrow. `organisation_id` is in here because it identifies a *business*, not a
 * person, and it is on every tenant table by construction. Anything that could name, locate or
 * contact a human is not on this list and must be classified.
 */
const STRUCTURAL = new Set([
  'id',
  'organisation_id',
  'location_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'version',
  'schema_version',
  'checksum',
  'applied_at',
  'duration_ms',
  'name',
]);

const CREATE_TABLE = /create table (?:if not exists )?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi;

export interface Column {
  readonly table: string;
  readonly column: string;
}

export function schemaColumns(directory: string = MIGRATIONS): Column[] {
  const sql = readdirSync(directory)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(directory, f), 'utf8'))
    .join('\n');

  const columns: Column[] = [];
  for (const match of sql.matchAll(CREATE_TABLE)) {
    const table = match[1] ?? '';
    for (const line of (match[2] ?? '').split('\n')) {
      const trimmed = line.trim();
      // Skip constraints and anything that is not a column definition.
      // A constraint, or the continuation line of one. `REFERENCES …` on its own line reads as a
      // column definition to the expression below, and produced a phantom column named
      // "REFERENCES" — a parser defect that would have been classified rather than fixed.
      if (
        trimmed === '' ||
        /^(primary|foreign|unique|constraint|check|exclude)\b/i.test(trimmed) ||
        /^(references|on\s+(delete|update)|deferrable|initially|not\s+deferrable)\b/i.test(trimmed)
      ) {
        continue;
      }
      const column = /^"?(\w+)"?\s+\w/.exec(trimmed)?.[1];
      if (column !== undefined) columns.push({ table, column });
    }
  }
  return columns;
}

export function unclassified(directory?: string, inventoryPath: string = INVENTORY): Column[] {
  const inventory = readFileSync(inventoryPath, 'utf8');
  return schemaColumns(directory).filter(({ table, column }) => {
    if (STRUCTURAL.has(column)) return false;
    // Classified if the inventory names the column, qualified or bare.
    return !inventory.includes(`${table}.${column}`) && !inventory.includes(`\`${column}\``);
  });
}

function main(): number {
  const missing = unclassified();
  if (missing.length > 0) {
    console.error('Columns with no entry in the personal-data inventory:');
    for (const { table, column } of missing) console.error(`  - ${table}.${column}`);
    console.error(
      '\n  Add each to docs/privacy/data-inventory.md with its category, retention and erasure\n' +
        '  method — or to STRUCTURAL in this script if it genuinely cannot identify a person.\n' +
        '  An unclassified column is the one an erasure request misses silently (QG-12).',
    );
    return 1;
  }
  console.log(
    `data classification: every column in ${String(schemaColumns().length)} checked is ` +
      'classified or structural.',
  );
  return 0;
}

process.exitCode = main();
