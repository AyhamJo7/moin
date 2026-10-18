/**
 * Vertical-slice browser report check (M2C).
 *
 * The full-stack browser job must not pass by running nothing. Playwright exits 0 when every
 * test that ran passed, and a skipped test, a renamed test or a deleted file would still leave a
 * green job. This reads the JSON report of that run and fails unless every required acceptance
 * test ran and passed, with nothing skipped, flaky or unexpected.
 *
 *   node scripts/check-slice-report.ts <playwright-report.json> [live-today-timings.jsonl]
 *
 * Prints a Markdown summary (for the job summary) on stdout; problems go to stderr.
 */

import { readFileSync } from 'node:fs';

/**
 * Each entry is a phrase one required acceptance test's title contains: every test of the suite.
 * Adding a test to the suite means adding its phrase here, so none can vanish unnoticed.
 */
export const REQUIRED_TITLES: readonly string[] = [
  'a stale view gets a truthful conflict message',
  'a response lost after the commit is reconciled',
  'a lost response that cannot be read back',
  'a request that never reached the server',
  'reaches the owner on Heute and stays there',
  'completes a callback with Erledigt and it stays completed',
  'appears by itself, once, without a reload',
  'reaches another open session',
  'an outage leaves the list as it is',
  'a revoked session shows the signed-out page',
];

interface Spec {
  title: string;
  ok: boolean;
}

interface Suite {
  specs?: Spec[];
  suites?: Suite[];
}

export interface PlaywrightReport {
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
  suites: Suite[];
}

function specsOf(suites: readonly Suite[]): Spec[] {
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...specsOf(suite.suites ?? [])]);
}

/** What is wrong with a report; empty when the acceptance run is whole and green. */
export function problems(report: PlaywrightReport): string[] {
  const found: string[] = [];
  const { expected, unexpected, flaky, skipped } = report.stats;
  if (unexpected > 0) found.push(`${String(unexpected)} test(s) failed`);
  if (flaky > 0) found.push(`${String(flaky)} test(s) were flaky (retries are off)`);
  if (skipped > 0) found.push(`${String(skipped)} test(s) were skipped`);
  const specs = specsOf(report.suites);
  if (expected < REQUIRED_TITLES.length) {
    found.push(
      `only ${String(expected)} passing test(s), at least ${String(REQUIRED_TITLES.length)} required`,
    );
  }
  for (const phrase of REQUIRED_TITLES) {
    const match = specs.find((spec) => spec.title.includes(phrase));
    if (match === undefined) found.push(`required test missing: "${phrase}"`);
    else if (!match.ok) found.push(`required test did not pass: "${match.title}"`);
  }
  return found;
}

function summary(report: PlaywrightReport, timings: string): string {
  const rows = specsOf(report.suites).map(
    (spec) => `| ${spec.ok ? 'pass' : 'FAIL'} | ${spec.title} |`,
  );
  return [
    '### Full-stack browser acceptance',
    '',
    `${String(report.stats.expected)} passed, ${String(report.stats.unexpected)} failed, ${String(report.stats.skipped)} skipped.`,
    '',
    '| Result | Test |',
    '| --- | --- |',
    ...rows,
    '',
    '#### Commit-to-render timings (task row `created_at` to visible card)',
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
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport;
  const timings = timingsPath === undefined ? '' : readFileSync(timingsPath, 'utf8');
  console.log(summary(report, timings));
  const found = problems(report);
  for (const line of found) console.error(`slice report: ${line}`);
  return found.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('check-slice-report.ts') === true) process.exitCode = main();
