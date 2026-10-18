/**
 * Vertical-slice browser report check (M2C).
 *
 * The full-stack browser job must not pass by running nothing, and must not certify a test that
 * did not actually pass. Playwright's own exit code and counters are not enough for that: a test
 * marked `test.fail()` is "expected" when it fails, is counted in `stats.expected`, has
 * `spec.ok: true` and leaves the exit code at 0 (reproduced with the control report
 * `scripts/__fixtures__/slice-report/control-test-fail.json`). So this reads the JSON report's
 * per-test records and accepts only a run in which every required test has one execution that
 * itself passed, first try, expected to pass.
 *
 *   node scripts/check-slice-report.ts <playwright-report.json> [live-today-timings.jsonl]
 *
 * Prints a Markdown summary (for the job summary) on stdout; problems go to stderr. Exit 0 only
 * for a valid, complete, green report.
 *
 * The report is read with the schema of Playwright's `json` reporter (version 1.63): `stats`,
 * `errors`, `config.projects`, `suites[].specs[].tests[]` with `projectName`, `expectedStatus`,
 * `status`, `annotations` and `results[]` (`status`, `retry`, `errors`).
 */

import { readFileSync } from 'node:fs';

/** The one project and spec file of the acceptance suite (`playwright.slice.config.ts`). */
export const REQUIRED_PROJECT = 'chromium';
export const REQUIRED_FILE = 'today-callback.spec.ts';

/**
 * Every test of the suite, by exact title. The suite is exactly this set: a test that is missing,
 * renamed, duplicated or not listed here makes the check fail, so adding a test to the suite
 * means adding its title here.
 */
export const REQUIRED_TITLES: readonly string[] = [
  'a simulated callback call reaches the owner on Heute and stays there',
  'the owner completes a callback with Erledigt and it stays completed',
  'a stale view gets a truthful conflict message and the current state',
  'a response lost after the commit is reconciled by reading the task, not reported as a failure',
  'a lost response that cannot be read back is unknown, and the refreshed view shows the truth',
  'a request that never reached the server is unknown to the browser; the retry completes once, by keyboard',
  'a callback committed while Heute is open appears by itself, once, without a reload',
  'a completion reaches another open session, and a replay of the call does not reopen it',
  'an outage leaves the list as it is, and the page reconciles when the network returns',
  'a revoked session shows the signed-out page and no task data',
];

/** Annotations that change what a test is expected to do; none is allowed on an acceptance test. */
const FORBIDDEN_ANNOTATIONS: readonly string[] = ['fail', 'skip', 'fixme'];

const STAT_KEYS = ['expected', 'unexpected', 'flaky', 'skipped'] as const;

type Record_ = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

interface Execution {
  readonly title: string;
  readonly file: string;
  readonly project: string;
  readonly specOk: unknown;
  readonly test: Record_;
}

/** Every test record of the report with the spec it belongs to; structure problems are appended. */
function executionsOf(
  suites: readonly unknown[],
  found: string[],
  path: string,
  into: Execution[] = [],
): Execution[] {
  suites.forEach((suite, suiteIndex) => {
    const where = `${path}/suites[${String(suiteIndex)}]`;
    if (!isRecord(suite)) {
      found.push(`report structure: ${where} is not an object`);
      return;
    }
    const { specs, suites: children } = suite;
    if (specs !== undefined && !Array.isArray(specs)) {
      found.push(`report structure: ${where}.specs is not an array`);
    } else {
      (specs ?? []).forEach((spec: unknown, specIndex: number) => {
        const at = `${where}/specs[${String(specIndex)}]`;
        if (!isRecord(spec) || typeof spec['title'] !== 'string' || !Array.isArray(spec['tests'])) {
          found.push(`report structure: ${at} has no title or tests array`);
          return;
        }
        const file = typeof spec['file'] === 'string' ? spec['file'] : '';
        for (const test of spec['tests'] as unknown[]) {
          if (!isRecord(test) || typeof test['projectName'] !== 'string') {
            found.push(`report structure: a test of "${spec['title']}" has no projectName`);
            continue;
          }
          into.push({
            title: spec['title'],
            file,
            project: test['projectName'],
            specOk: spec['ok'],
            test,
          });
        }
      });
    }
    if (children !== undefined) {
      if (Array.isArray(children)) executionsOf(children as unknown[], found, where, into);
      else found.push(`report structure: ${where}.suites is not an array`);
    }
  });
  return into;
}

/** Why one execution does not count as a pass; empty when it is a clean first-try pass. */
function whyNotPassed(execution: Execution): string[] {
  const { test } = execution;
  const found: string[] = [];
  const label = `"${execution.title}"`;
  if (test['expectedStatus'] !== 'passed') {
    found.push(
      `${label}: expected status is ${JSON.stringify(test['expectedStatus'])}, not "passed" (a test annotated to fail cannot certify the workflow)`,
    );
  }
  if (test['status'] !== 'expected') {
    found.push(`${label}: outcome is ${JSON.stringify(test['status'])}, not "expected"`);
  }
  if (execution.specOk !== true) found.push(`${label}: spec.ok is not true`);
  const annotations = test['annotations'];
  if (!Array.isArray(annotations)) {
    found.push(`${label}: annotations are missing`);
  } else {
    for (const annotation of annotations as unknown[]) {
      const type = isRecord(annotation) ? annotation['type'] : undefined;
      if (typeof type === 'string' && FORBIDDEN_ANNOTATIONS.includes(type)) {
        found.push(`${label}: carries the "${type}" annotation`);
      }
    }
  }
  const results = test['results'];
  if (!Array.isArray(results) || results.length === 0) {
    found.push(`${label}: no execution results recorded (the test did not run)`);
  } else if (results.length !== 1) {
    found.push(
      `${label}: ${String(results.length)} attempts recorded; the suite runs without retries, so every test must pass on its single attempt`,
    );
  } else {
    const result = results[0] as unknown;
    if (!isRecord(result)) {
      found.push(`${label}: its result record is not an object`);
    } else {
      if (result['status'] !== 'passed') {
        found.push(
          `${label}: the execution ended as ${JSON.stringify(result['status'])}, not "passed"`,
        );
      }
      if (result['retry'] !== 0)
        found.push(`${label}: not a first attempt (retry ${JSON.stringify(result['retry'])})`);
      const errors = result['errors'];
      if (!Array.isArray(errors) || errors.length > 0) {
        found.push(`${label}: the execution recorded errors or no error list`);
      }
    }
  }
  return found;
}

/**
 * What is wrong with a parsed report; empty only when the report is valid, complete and green.
 * The report is untrusted JSON: nothing is read before it is checked.
 */
export function problems(report: unknown): string[] {
  if (!isRecord(report)) return ['report structure: not a JSON object'];
  const found: string[] = [];

  const { stats, errors, suites, config } = report;
  const counts: Partial<Record<(typeof STAT_KEYS)[number], number>> = {};
  if (!isRecord(stats)) {
    found.push('report structure: stats is missing or not an object');
  } else {
    for (const key of STAT_KEYS) {
      const value = stats[key];
      if (isCount(value)) counts[key] = value;
      else found.push(`report structure: stats.${key} is not a non-negative integer`);
    }
  }
  if (!Array.isArray(errors)) found.push('report structure: errors is missing or not an array');
  else if (errors.length > 0)
    found.push(
      `report has ${String(errors.length)} global error(s) (run did not complete cleanly)`,
    );
  if (!Array.isArray(suites)) {
    found.push('report structure: suites is missing or not an array');
    return found;
  }
  if (!isRecord(config) || !Array.isArray(config['projects'])) {
    found.push('report structure: config.projects is missing');
  } else {
    const names = (config['projects'] as unknown[]).map((p) =>
      isRecord(p) ? p['name'] : undefined,
    );
    if (names.length !== 1 || names[0] !== REQUIRED_PROJECT) {
      found.push(
        `config: projects are ${JSON.stringify(names)}, expected only "${REQUIRED_PROJECT}"`,
      );
    }
  }

  const executions = executionsOf(suites as unknown[], found, '');

  // Identity: one execution per required title, in the right project and file; nothing else.
  const seen = new Map<string, Execution[]>();
  for (const execution of executions) {
    const key = execution.title;
    seen.set(key, [...(seen.get(key) ?? []), execution]);
  }
  for (const title of REQUIRED_TITLES) {
    const matches = seen.get(title) ?? [];
    if (matches.length === 0) found.push(`required test missing: "${title}"`);
    else if (matches.length > 1)
      found.push(`required test appears ${String(matches.length)} times: "${title}"`);
    else {
      const [only] = matches;
      if (only !== undefined) {
        if (only.project !== REQUIRED_PROJECT) {
          found.push(
            `"${title}": ran in project "${only.project}", expected "${REQUIRED_PROJECT}"`,
          );
        }
        if (only.file !== REQUIRED_FILE) {
          found.push(`"${title}": comes from file "${only.file}", expected "${REQUIRED_FILE}"`);
        }
        found.push(...whyNotPassed(only));
      }
    }
  }
  for (const execution of executions) {
    if (!REQUIRED_TITLES.includes(execution.title)) {
      found.push(
        `unlisted test in the acceptance suite: "${execution.title}" (add it to REQUIRED_TITLES)`,
      );
    }
  }

  // The reported totals must agree with the records, and the records must show a clean run.
  const derived = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const { test } of executions) {
    const status = test['status'];
    if (
      status === 'expected' ||
      status === 'unexpected' ||
      status === 'flaky' ||
      status === 'skipped'
    ) {
      derived[status] += 1;
    } else {
      found.push(`a test has an unknown outcome ${JSON.stringify(status)}`);
    }
  }
  for (const key of STAT_KEYS) {
    const reported = counts[key];
    if (reported !== undefined && reported !== derived[key]) {
      found.push(
        `stats.${key} is ${String(reported)} but the test records show ${String(derived[key])}`,
      );
    }
  }
  for (const key of ['unexpected', 'flaky', 'skipped'] as const) {
    if (derived[key] > 0) found.push(`${String(derived[key])} test(s) ended ${key}`);
  }
  return found;
}

function outcomeOf(report: unknown, title: string): string {
  if (!isRecord(report) || !Array.isArray(report['suites'])) return 'invalid';
  const execution = executionsOf(report['suites'] as unknown[], [], '').find(
    (e) => e.title === title,
  );
  const results = execution?.test['results'];
  const first: unknown = Array.isArray(results) ? results[0] : undefined;
  return isRecord(first) && typeof first['status'] === 'string' ? first['status'] : 'not run';
}

function summary(report: unknown, found: readonly string[], timings: string): string {
  const rows = REQUIRED_TITLES.map((title) => `| ${outcomeOf(report, title)} | ${title} |`);
  return [
    '### Full-stack browser acceptance',
    '',
    found.length === 0
      ? `ACCEPTED: all ${String(REQUIRED_TITLES.length)} required tests ran once and passed.`
      : `REJECTED: ${String(found.length)} problem(s); this run does not certify the workflow.`,
    '',
    ...found.map((line) => `- ${line}`),
    '',
    '| Execution result | Test |',
    '| --- | --- |',
    ...rows,
    '',
    '#### Timings (task row `created_at` to visible card, or as labelled)',
    '',
    '```',
    timings.trim(),
    '```',
  ].join('\n');
}

function main(): number {
  const [reportPath, timingsPath] = process.argv.slice(2);
  if (reportPath === undefined) {
    console.error('usage: check-slice-report.ts <playwright-report.json> [timings.jsonl]');
    return 2;
  }
  let timings = '';
  try {
    if (timingsPath !== undefined) timings = readFileSync(timingsPath, 'utf8');
  } catch {
    timings = '(no timings file)';
  }
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable';
    console.log(summary(undefined, [`the report could not be read: ${reason}`], timings));
    console.error(`slice report: the report could not be read: ${reason}`);
    return 1;
  }
  const found = problems(report);
  console.log(summary(report, found, timings));
  for (const line of found) console.error(`slice report: ${line}`);
  return found.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('check-slice-report.ts') === true) process.exitCode = main();
