import { describe, expect, it } from 'vitest';
import { REQUIRED_TITLES, problems, type PlaywrightReport } from './check-slice-report.ts';

function report(
  titles: readonly string[],
  overrides: Partial<PlaywrightReport['stats']> = {},
  failing: readonly string[] = [],
): PlaywrightReport {
  return {
    stats: { expected: titles.length, unexpected: 0, flaky: 0, skipped: 0, ...overrides },
    suites: [
      { suites: [{ specs: titles.map((title) => ({ title, ok: !failing.includes(title) })) }] },
    ],
  };
}

const ALL = REQUIRED_TITLES.map((phrase) => `a test where ${phrase}`);

describe('the vertical-slice report check', () => {
  it('accepts a whole, green run', () => {
    expect(problems(report(ALL))).toStrictEqual([]);
  });

  it('rejects a run that executed nothing', () => {
    expect(problems(report([], { expected: 0 })).length).toBeGreaterThan(0);
  });

  it('rejects a missing required test even when everything that ran passed', () => {
    const found = problems(report(ALL.slice(1), { expected: 10 }));
    expect(found).toContain(`required test missing: "${REQUIRED_TITLES[0] ?? ''}"`);
  });

  it('rejects skipped, flaky and failed tests', () => {
    expect(problems(report(ALL, { skipped: 1 }))).toContain('1 test(s) were skipped');
    expect(problems(report(ALL, { flaky: 1 }))).toContain('1 test(s) were flaky (retries are off)');
    const failing = ALL[2] ?? '';
    const found = problems(report(ALL, { unexpected: 1 }, [failing]));
    expect(found).toContain('1 test(s) failed');
    expect(found).toContain(`required test did not pass: "${failing}"`);
  });
});
