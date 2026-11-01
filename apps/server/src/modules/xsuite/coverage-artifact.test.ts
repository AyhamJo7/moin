import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { INVENTORY } from './inventory.ts';
import { buildCoverageReport, coverageArtifact, key, ProbeLedger } from './probe-ledger.ts';

const WORKFLOW = readFileSync(
  resolve(import.meta.dirname, '../../../../../.github/workflows/verify.yml'),
  'utf8',
);

describe('the stored coverage report (P06.13.05)', () => {
  evidenceTest('carries the figure, the inventory and the outcome of every route', () => {
    const ledger = new ProbeLedger();
    for (const route of INVENTORY.slice(1)) {
      ledger.record(key(route), { status: 404, check: 'foreign id answers 404' });
    }
    const artifact = coverageArtifact(buildCoverageReport(INVENTORY, ledger), {
      commit: 'abc',
      generatedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(artifact['coverage']).toBe(
      `${String(INVENTORY.length - 1)} of ${String(INVENTORY.length)} probed`,
    );
    expect(artifact['unprobed']).toStrictEqual([key(INVENTORY[0]!)]);
    const rows = artifact['rows'] as Record<string, unknown>[];
    expect(rows).toHaveLength(INVENTORY.length);
    expect(rows[0]).toMatchObject({ probed: false, status: null });
    expect(rows[1]).toMatchObject({ probed: true, status: 404, check: 'foreign id answers 404' });
  });

  evidenceTest(
    'the CI job prints the figure and uploads the report even when the suite fails',
    () => {
      // The wiring is part of the control: an artifact that is not uploaded on failure, or that
      // leaves the report out, would put the old pass/fail JSON back as the only evidence.
      expect(WORKFLOW).toContain('test-results/xsuite-coverage.json');
      expect(WORKFLOW).toMatch(
        /name: xsuite-coverage[\s\S]*?path: \|[\s\S]*?test-results\/xsuite-coverage\.json/,
      );
      expect(WORKFLOW).toMatch(
        /- uses: actions\/upload-artifact[^\n]*\n\s+if: \$\{\{ !cancelled\(\) \}\}/,
      );
      expect(WORKFLOW).toContain('xsuite route coverage: ');
    },
  );
});
