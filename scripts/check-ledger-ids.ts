/**
 * Evidence IDs are unique, and the registry and the record files agree.
 *
 * A stale commit carried through a rebase once brought back an evidence ID that had been renamed,
 * so the registry held the same `EV-Pxx-nnn` twice. A duplicate ID makes every citation of it
 * ambiguous: a ticked PLAN item can point at either record. `.claude/bin/evidence.py check` finds
 * this locally, but it also checks that every cited commit exists, and a squash-merged branch's
 * commits do not exist in CI's clone. This is the part of that audit that is true on any clone, so
 * it can run on every pull request.
 *
 *   node scripts/check-ledger-ids.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(REPO_ROOT, 'docs', 'evidence');

/** A registry row: | EV-P06-001 | item | date | commit | summary | [file](P06/EV-P06-001-x.md) | */
const INDEX_ROW = /^\|\s*(EV-P\d{2}-\d{3})\s*\|.*\]\(([^)]+)\)\s*\|\s*$/gm;
const RECORD_FILE = /^(EV-P\d{2}-\d{3})-.*\.md$/;

export interface LedgerFindings {
  readonly duplicateRows: string[];
  readonly duplicateRecords: string[];
  readonly unregistered: string[];
  readonly missingRecords: string[];
  readonly checked: number;
}

/** `records` are paths relative to docs/evidence, e.g. `P06/EV-P06-001-x.md`. */
export function audit(indexText: string, records: readonly string[]): LedgerFindings {
  const rows = [...indexText.matchAll(INDEX_ROW)].map((m) => ({
    id: m[1] ?? '',
    link: m[2] ?? '',
  }));
  const byRecordId = new Map<string, string[]>();
  for (const rel of records) {
    const id = RECORD_FILE.exec(rel.split('/').pop() ?? '')?.[1];
    if (id !== undefined) byRecordId.set(id, [...(byRecordId.get(id) ?? []), rel]);
  }
  const counts = new Map<string, number>();
  for (const { id } of rows) counts.set(id, (counts.get(id) ?? 0) + 1);
  const recordSet = new Set(records);
  return {
    duplicateRows: [...counts]
      .filter(([, n]) => n > 1)
      .map(([id, n]) => `${id} (${String(n)} rows)`),
    duplicateRecords: [...byRecordId]
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id}: ${files.join(', ')}`),
    unregistered: [...byRecordId.keys()].filter((id) => !counts.has(id)),
    missingRecords: rows.filter((r) => !recordSet.has(r.link)).map((r) => `${r.id} → ${r.link}`),
    checked: rows.length,
  };
}

export function recordFiles(root: string = EVIDENCE): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^P\d{2}$/.test(d.name))
    .flatMap((d) => readdirSync(join(root, d.name)).map((f) => `${d.name}/${f}`))
    .filter((rel) => RECORD_FILE.test(rel.split('/').pop() ?? ''));
}

function main(): number {
  const result = audit(readFileSync(join(EVIDENCE, 'INDEX.md'), 'utf8'), recordFiles());
  let failed = false;
  for (const [label, items] of [
    ['evidence IDs registered more than once', result.duplicateRows],
    ['evidence IDs with more than one record file', result.duplicateRecords],
    ['record files not registered in INDEX.md', result.unregistered],
    ['registry rows whose record file does not exist', result.missingRecords],
  ] as const) {
    if (items.length > 0) {
      failed = true;
      console.error(`${label}:`);
      for (const item of items) console.error(`  - ${item}`);
    }
  }
  if (failed) {
    console.error(
      '\n  Re-number the later record with `evidence.py new` rather than editing IDs by hand, and\n' +
        '  after a rebase take main’s INDEX.md and re-append only this branch’s rows.',
    );
    return 1;
  }
  console.log(
    `Evidence ledger: ${String(result.checked)} IDs, each unique and backed by one record.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
