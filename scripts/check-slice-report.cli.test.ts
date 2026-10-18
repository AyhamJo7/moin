/**
 * The report check as the workflow runs it (M2C, finding F1): `node scripts/check-slice-report.ts
 * <report>` must certify a clean run and must not certify a run in which a required test used
 * `test.fail()` and failed. Playwright itself calls that run green (`stats.expected` 10,
 * `spec.ok` true, exit 0), which is how the first version of the checker accepted it.
 *
 * This file imports nothing from the checker: it only runs the command against the real
 * Playwright reports in `scripts/__fixtures__/slice-report`, so a checker that fails to load or
 * crashes cannot satisfy its assertions by accident (the official mutation check relies on that).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, 'check-slice-report.ts');
const FIXTURES = resolve(import.meta.dirname, '__fixtures__/slice-report');

function run(fixture: string) {
  return spawnSync(process.execPath, [SCRIPT, resolve(FIXTURES, fixture)], { encoding: 'utf8' });
}

describe('check-slice-report as a command', () => {
  it('certifies the real green CI report and a genuine all-pass report', () => {
    for (const fixture of ['ci-run-39092001906.json', 'control-all-pass.json']) {
      const outcome = run(fixture);
      expect(outcome.status, `${fixture}: ${outcome.stderr}`).toBe(0);
      expect(outcome.stdout).toContain('10 required tests ran once and passed');
    }
  });

  it('does not certify the genuine report in which a required test used test.fail() and failed', () => {
    const outcome = run('control-test-fail.json');
    expect(outcome.status, 'a failed required test was certified (exit code)').toBe(1);
    expect(outcome.stdout).toContain('REJECTED');
    expect(outcome.stdout).not.toContain('ACCEPTED');
    expect(outcome.stderr).toContain('expected status is "failed"');
  });
});
