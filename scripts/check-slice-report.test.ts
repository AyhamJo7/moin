/**
 * The vertical-slice report check (M2C): a required acceptance test that did not actually pass
 * must never be certified, whatever Playwright's counters and exit code say.
 *
 * Fixtures are in `scripts/__fixtures__/slice-report` (provenance in its README): the real report
 * of the green CI run, and genuine Playwright reports of a ten-test suite with the acceptance
 * suite's file name, project and titles in which one test is made to fail as expected
 * (`test.fail()`), skip, flake on a retry or time out. The remaining negatives are derived from
 * the real CI report by one named change each.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REQUIRED_FILE,
  REQUIRED_PROJECT,
  REQUIRED_TITLES,
  problems,
} from './check-slice-report.ts';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__/slice-report');
const SCRIPT = resolve(import.meta.dirname, 'check-slice-report.ts');

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Json;
}

/** The real report of CI run 39092001906 (all ten tests passed). */
function ci(): Json {
  return fixture('ci-run-39092001906.json');
}

/** The report's test record for a required title, to change in place. */
function testOf(report: Json, index: number): Json {
  const suite = (report['suites'] as Json[])[0]!;
  const spec = (suite['specs'] as Json[])[index]!;
  return (spec['tests'] as Json[])[0]!;
}

function specOf(report: Json, index: number): Json {
  return (report['suites'] as Json[])[0]!['specs'] instanceof Array
    ? ((report['suites'] as Json[])[0]!['specs'] as Json[])[index]!
    : {};
}

function resultOf(report: Json, index: number): Json {
  return (testOf(report, index)['results'] as Json[])[0]!;
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function scriptOutcome(content: string | undefined) {
  const directory = mkdtempSync(join(tmpdir(), 'slice-report-'));
  directories.push(directory);
  const path = join(directory, 'report.json');
  if (content !== undefined) writeFileSync(path, content);
  return spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
}

describe('what is accepted', () => {
  it('the real green CI report', () => {
    expect(problems(ci())).toStrictEqual([]);
  });

  it('a genuine Playwright report of ten passing tests', () => {
    expect(problems(fixture('control-all-pass.json'))).toStrictEqual([]);
  });

  it('the contract is the ten tests the suite has, in the project and file CI runs', () => {
    expect(REQUIRED_TITLES).toHaveLength(10);
    expect(new Set(REQUIRED_TITLES).size).toBe(10);
    const names = (ci()['suites'] as Json[])[0]!['specs'] as Json[];
    expect(names.map((spec) => spec['title'])).toStrictEqual(REQUIRED_TITLES);
    expect(REQUIRED_PROJECT).toBe('chromium');
    expect(REQUIRED_FILE).toBe('today-callback.spec.ts');
  });
});

describe('genuine Playwright reports of a test that did not pass', () => {
  it('rejects test.fail(): counted as expected, spec ok, exit code 0, but the test failed', () => {
    const report = fixture('control-test-fail.json');
    // The defect this guards: every Playwright indicator calls this run green.
    expect((report['stats'] as Json)['expected']).toBe(10);
    expect(specOf(report, 3)['ok']).toBe(true);
    expect(testOf(report, 3)['status']).toBe('expected');
    expect(resultOf(report, 3)['status']).toBe('failed');
    const found = problems(report);
    expect(found.some((line) => line.includes('expected status is "failed"'))).toBe(true);
    expect(found.some((line) => line.includes('execution ended as "failed"'))).toBe(true);
    expect(found.some((line) => line.includes('carries the "fail" annotation'))).toBe(true);
  });

  it('rejects a skipped test', () => {
    const found = problems(fixture('control-skip.json'));
    expect(found.some((line) => line.includes('"skipped"'))).toBe(true);
    expect(found).toContain('1 test(s) ended skipped');
  });

  it('rejects a test that flaked: failed, then passed on a retry', () => {
    const found = problems(fixture('control-flaky.json'));
    expect(found).toContain('1 test(s) ended flaky');
    expect(found.some((line) => line.includes('2 attempts recorded'))).toBe(true);
  });

  it('rejects a test that timed out', () => {
    const found = problems(fixture('control-timeout.json'));
    expect(found).toContain('1 test(s) ended unexpected');
    expect(found.some((line) => line.includes('"timedOut"'))).toBe(true);
  });
});

describe('derived from the real report, one change each', () => {
  it('a required test failed unexpectedly', () => {
    const report = ci();
    testOf(report, 6)['status'] = 'unexpected';
    resultOf(report, 6)['status'] = 'failed';
    specOf(report, 6)['ok'] = false;
    const found = problems(report);
    expect(found.some((line) => line.includes('outcome is "unexpected"'))).toBe(true);
    expect(
      found.some((line) => line.includes('stats.expected is 10 but the test records show 9')),
    ).toBe(true);
  });

  it('a test interrupted mid-run', () => {
    const report = ci();
    resultOf(report, 8)['status'] = 'interrupted';
    expect(problems(report).some((line) => line.includes('"interrupted"'))).toBe(true);
  });

  it('statistics claim success but the record failed', () => {
    const report = ci();
    resultOf(report, 2)['status'] = 'failed';
    expect(problems(report).some((line) => line.includes('execution ended as "failed"'))).toBe(
      true,
    );
  });

  it('statistics replaced by an empty object', () => {
    const report = ci();
    report['stats'] = {};
    const found = problems(report);
    expect(found).toContain('report structure: stats.expected is not a non-negative integer');
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it('statistics missing, nonnumeric, fractional or negative', () => {
    for (const bad of [undefined, 'ten', 9.5, -1, null, Number.NaN]) {
      const report = ci();
      (report['stats'] as Json)['expected'] = bad;
      expect(problems(report)).toContain(
        'report structure: stats.expected is not a non-negative integer',
      );
    }
    const report = ci();
    delete report['stats'];
    expect(problems(report)).toContain('report structure: stats is missing or not an object');
  });

  it('statistics that disagree with the records', () => {
    const report = ci();
    (report['stats'] as Json)['skipped'] = 1;
    expect(problems(report)).toContain('stats.skipped is 1 but the test records show 0');
  });

  it('a required test missing', () => {
    const report = ci();
    (report['suites'] as Json[])[0]!['specs'] = (
      (report['suites'] as Json[])[0]!['specs'] as Json[]
    ).slice(1);
    const found = problems(report);
    expect(found).toContain(`required test missing: "${REQUIRED_TITLES[0] ?? ''}"`);
  });

  it('a required test replaced by another', () => {
    const report = ci();
    specOf(report, 4)['title'] = 'some other test';
    const found = problems(report);
    expect(found).toContain(`required test missing: "${REQUIRED_TITLES[4] ?? ''}"`);
    expect(found.some((line) => line.includes('unlisted test'))).toBe(true);
  });

  it('a duplicate record standing in for a distinct test', () => {
    const report = ci();
    const specs = (report['suites'] as Json[])[0]!['specs'] as Json[];
    specs[9] = structuredClone(specs[8])!;
    const found = problems(report);
    expect(found).toContain(`required test appears 2 times: "${REQUIRED_TITLES[8] ?? ''}"`);
    expect(found).toContain(`required test missing: "${REQUIRED_TITLES[9] ?? ''}"`);
  });

  it('the same suite run in the wrong project', () => {
    const report = ci();
    for (let index = 0; index < 10; index += 1) {
      testOf(report, index)['projectName'] = 'firefox';
    }
    ((report['config'] as Json)['projects'] as Json[])[0]!['name'] = 'firefox';
    const found = problems(report);
    expect(found.some((line) => line.includes('ran in project "firefox"'))).toBe(true);
    expect(found.some((line) => line.includes('projects are ["firefox"]'))).toBe(true);
  });

  it('a test from another file', () => {
    const report = ci();
    specOf(report, 0)['file'] = 'smoke.spec.ts';
    expect(problems(report).some((line) => line.includes('comes from file "smoke.spec.ts"'))).toBe(
      true,
    );
  });

  it('an extra test in the suite', () => {
    const report = ci();
    const specs = (report['suites'] as Json[])[0]!['specs'] as Json[];
    specs.push({ ...structuredClone(specs[0]), title: 'a newly added test' });
    expect(problems(report).some((line) => line.includes('unlisted test'))).toBe(true);
  });

  it('missing results, an empty results array or an invalid result record', () => {
    for (const bad of [undefined, [], [null], ['passed'], 'passed']) {
      const report = ci();
      testOf(report, 5)['results'] = bad;
      expect(problems(report).length).toBeGreaterThan(0);
    }
  });

  it('a test annotated to fail, with the failed result and a matching expected status', () => {
    const report = ci();
    testOf(report, 1)['expectedStatus'] = 'failed';
    testOf(report, 1)['annotations'] = [{ type: 'fail' }];
    resultOf(report, 1)['status'] = 'failed';
    const found = problems(report);
    expect(found.some((line) => line.includes('carries the "fail" annotation'))).toBe(true);
  });

  it('a passed execution that nevertheless recorded errors', () => {
    const report = ci();
    resultOf(report, 5)['errors'] = [{ message: 'assertion failed' }];
    expect(problems(report).some((line) => line.includes('recorded errors'))).toBe(true);
  });

  it('a retry hiding an earlier failure', () => {
    const report = ci();
    const result = resultOf(report, 3);
    (testOf(report, 3)['results'] as Json[]).unshift({ ...result, status: 'failed', retry: 0 });
    result['retry'] = 1;
    expect(problems(report).some((line) => line.includes('2 attempts recorded'))).toBe(true);
  });

  it('global errors in the report', () => {
    const report = ci();
    report['errors'] = [{ message: 'worker crashed' }];
    expect(problems(report)).toContain(
      'report has 1 global error(s) (run did not complete cleanly)',
    );
    delete report['errors'];
    expect(problems(report)).toContain('report structure: errors is missing or not an array');
  });

  it('missing or malformed structure', () => {
    for (const bad of [null, [], 'text', 42, {}]) {
      expect(problems(bad).length).toBeGreaterThan(0);
    }
    const report = ci();
    report['suites'] = 'none';
    expect(problems(report)).toContain('report structure: suites is missing or not an array');
    const noConfig = ci();
    delete noConfig['config'];
    expect(problems(noConfig)).toContain('report structure: config.projects is missing');
  });
});

describe('the command, as the workflow runs it', () => {
  it('exits 0 and says ACCEPTED for the real CI report', () => {
    const outcome = scriptOutcome(readFileSync(join(FIXTURES, 'ci-run-39092001906.json'), 'utf8'));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain('ACCEPTED: all 10 required tests ran once and passed.');
  });

  it('exits 1 for the genuine test.fail() report and never prints "passed" for it', () => {
    const outcome = scriptOutcome(readFileSync(join(FIXTURES, 'control-test-fail.json'), 'utf8'));
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain('REJECTED');
    expect(outcome.stdout).not.toContain('ACCEPTED');
    expect(outcome.stderr).toContain('expected status is "failed"');
  });

  it('exits 1 for an empty, malformed or missing report file', () => {
    expect(scriptOutcome('').status).toBe(1);
    expect(scriptOutcome('{not json').status).toBe(1);
    expect(scriptOutcome(undefined).status).toBe(1);
  });

  it('keeps its exit code through a pipe under pipefail, as the workflow step does', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slice-report-'));
    directories.push(directory);
    const path = join(directory, 'report.json');
    writeFileSync(path, readFileSync(join(FIXTURES, 'control-test-fail.json'), 'utf8'));
    const run = (flags: string[]) =>
      spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          ...flags,
          '-c',
          `node "${SCRIPT}" "${path}" 2>/dev/null | tee /dev/null >/dev/null`,
        ],
        { encoding: 'utf8' },
      );
    expect(run(['-e', '-o', 'pipefail']).status).toBe(1);
    // Without pipefail the pipe would have hidden the rejection: the reason the step sets it.
    expect(run(['-e']).status).toBe(0);
  });
});
