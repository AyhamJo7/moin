import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverage, indexedAdrs, loadAdrs } from './check-adr-coverage.ts';

describe('ADR coverage (P03.01.05)', () => {
  it('the real ADR set is fully covered', () => {
    const result = coverage();
    expect(result.adrsWithoutVerification).toStrictEqual([]);
    expect(result.invariantsWithoutAdr).toStrictEqual([]);
    expect(result.adrsMissingFromIndex).toStrictEqual([]);
    expect(result.indexEntriesWithoutFile).toStrictEqual([]);
  });

  it('every ADR carries its number, so the index can be matched against the files', () => {
    for (const adr of loadAdrs()) {
      expect(adr.number, adr.file).toMatch(/^\d{4}$/u);
      expect(adr.id).toBe(`ADR-${adr.number}`);
    }
  });
});

describe('the index check', () => {
  // This assertion is the regression test for a gap the checker had: two ADRs were added, every
  // check passed, and neither was in the index. Without the check, the case below reports nothing.
  it('reads only the ADR links out of an index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-index-'));
    const path = join(dir, 'README.md');
    writeFileSync(
      path,
      [
        '# Index',
        '| [0001](0001-something.md) | A | ACCEPTED | P03 |',
        '| [0044](0044-other-thing.md) | B | ACCEPTED | P02 |',
        'A link to [the template](TEMPLATE.md) and to [the plan](../../PLAN.md).',
      ].join('\n'),
      'utf8',
    );
    expect([...indexedAdrs(path)].sort()).toStrictEqual(['0001', '0044']);
  });

  it('finds nothing in an index that links to no ADR', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-index-'));
    const path = join(dir, 'README.md');
    writeFileSync(path, '# Index\n\nNothing here yet.\n', 'utf8');
    expect(indexedAdrs(path).size).toBe(0);
  });
});
