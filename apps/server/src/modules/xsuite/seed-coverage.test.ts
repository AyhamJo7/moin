import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import {
  assertSeedCoverage,
  checkSeedCoverage,
  SEEDED_TABLES,
  UNSEEDED_TABLES,
} from './seed-coverage.ts';

const LIVE = [...SEEDED_TABLES, ...Object.keys(UNSEEDED_TABLES)];

describe('the two-tenant seed accounts for every FORCE-RLS table', () => {
  evidenceTest('the registry plus the seeded list is exactly the live table set', () => {
    const coverage = checkSeedCoverage(LIVE);
    expect(coverage.summary).toBe(
      `${String(SEEDED_TABLES.length)} of ${String(LIVE.length)} FORCE-RLS tables seeded, ${String(Object.keys(UNSEEDED_TABLES).length)} registered with a reason`,
    );
    expect(() => {
      assertSeedCoverage(coverage);
    }).not.toThrow();
  });

  evidenceTest('a new FORCE-RLS table with no seed and no reason fails', () => {
    expect(() => {
      assertSeedCoverage(checkSeedCoverage([...LIVE, 'zz_new_table']));
    }).toThrow(/no seed and no registered reason: zz_new_table/);
  });

  evidenceTest('a registered table that no longer exists, or is also seeded, fails', () => {
    const [gone] = Object.keys(UNSEEDED_TABLES);
    expect(() => {
      assertSeedCoverage(checkSeedCoverage(LIVE.filter((table) => table !== gone)));
    }).toThrow(/registered but not FORCE-RLS tables/);
    const [first] = SEEDED_TABLES;
    expect(() => {
      assertSeedCoverage(
        checkSeedCoverage(LIVE, SEEDED_TABLES, { ...UNSEEDED_TABLES, [first ?? '']: 'x' }),
      );
    }).toThrow(/both seeded and registered/);
  });

  evidenceTest('a registered table without a reason fails', () => {
    const [first] = Object.keys(UNSEEDED_TABLES);
    expect(() => {
      assertSeedCoverage(
        checkSeedCoverage(LIVE, SEEDED_TABLES, { ...UNSEEDED_TABLES, [first ?? '']: '  ' }),
      );
    }).toThrow(/registered without a reason/);
  });
});
