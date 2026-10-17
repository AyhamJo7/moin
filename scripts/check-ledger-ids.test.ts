import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit, recordFiles } from './check-ledger-ids.ts';

const INDEX = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  'docs/evidence/INDEX.md',
);

const row = (id: string, file: string): string =>
  `| ${id} | P06.01.01 | 2026-10-01 | \`abc1234\` | summary | [${file}](${file}) |`;

describe('evidence ledger IDs', () => {
  it('the real registry is clean', () => {
    const result = audit(readFileSync(INDEX, 'utf8'), recordFiles());
    expect(result.checked).toBeGreaterThan(300);
    expect(result.duplicateRows).toStrictEqual([]);
    expect(result.duplicateRecords).toStrictEqual([]);
    expect(result.unregistered).toStrictEqual([]);
    expect(result.missingRecords).toStrictEqual([]);
  });

  // The incident: a renamed ID came back through a stale commit after a rebase.
  it('reports an ID registered twice', () => {
    const index = [
      row('EV-P06-001', 'P06/EV-P06-001-a.md'),
      row('EV-P06-001', 'P06/EV-P06-001-a.md'),
    ];
    const result = audit(index.join('\n'), ['P06/EV-P06-001-a.md']);
    expect(result.duplicateRows).toStrictEqual(['EV-P06-001 (2 rows)']);
  });

  it('reports two record files carrying the same ID', () => {
    const result = audit(row('EV-P06-002', 'P06/EV-P06-002-a.md'), [
      'P06/EV-P06-002-a.md',
      'P06/EV-P06-002-renamed.md',
    ]);
    expect(result.duplicateRecords).toStrictEqual([
      'EV-P06-002: P06/EV-P06-002-a.md, P06/EV-P06-002-renamed.md',
    ]);
  });

  it('reports records nobody registered and rows with no record', () => {
    const result = audit(row('EV-P06-003', 'P06/EV-P06-003-gone.md'), ['P06/EV-P06-004-new.md']);
    expect(result.unregistered).toStrictEqual(['EV-P06-004']);
    expect(result.missingRecords).toStrictEqual(['EV-P06-003 → P06/EV-P06-003-gone.md']);
  });
});
