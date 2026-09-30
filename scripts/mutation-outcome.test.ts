/**
 * The mutation classifier, checked (P06.10.07).
 *
 * The harness that produces mutation evidence is itself a control, and it was wrong: it treated any
 * non-zero exit as a kill, so an unreachable database reported every variant killed and a manifest
 * entry naming a nonexistent test reported it survived. A count produced that way is not evidence,
 * so the decision is now a pure function and these are the cases it must not collapse.
 *
 * The four report fixtures are **captured from real Vitest runs**, not written by hand — a
 * classifier tested against invented shapes would only prove it agrees with my guess about the
 * reporter.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  baselineIsUsable,
  classifyRun,
  type RunObservation,
  type VitestReport,
} from './mutation-outcome.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'mutation');

function fixture(name: string): VitestReport {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as VitestReport;
}

function observation(overrides: Partial<RunObservation> = {}): RunObservation {
  return {
    report: undefined,
    timedOut: false,
    exitCode: 1,
    output: '',
    phase: 'mutant',
    ...overrides,
  };
}

describe('a genuine kill', () => {
  it('is the named test running and failing on an assertion', () => {
    const result = classifyRun(
      observation({ report: fixture('named-assertion-failed') }),
      'fails an assertion',
    );
    expect(result.outcome).toBe('KILLED_ASSERTION');
    expect(result.matched).toBe(1);
    expect(result.unrelatedFailures).toBe(0);
  });

  it('requires the failure to be an assertion, not the test dying of something else', () => {
    // The named test ran and threw, but not because it rejected a value. That is an environment
    // problem wearing a test failure's exit code.
    const report: VitestReport = {
      testResults: [
        {
          status: 'failed',
          message: '',
          assertionResults: [
            {
              status: 'failed',
              fullName: 'suite the named test',
              failureMessages: ['Error: connect ECONNREFUSED 127.0.0.1:5432'],
            },
          ],
        },
      ],
    };
    expect(classifyRun(observation({ report }), 'the named test').outcome).toBe('INFRA_FAILURE');
  });
});

describe('what must never be counted as a kill', () => {
  it('a suite whose setup failed — the case that made every variant look killed', () => {
    const result = classifyRun(
      observation({ report: fixture('suite-setup-failed') }),
      'never runs',
    );
    expect(result.outcome).toBe('INFRA_FAILURE');
    expect(result.detail).toMatch(/before its tests/u);
  });

  it('an unreachable database, with no report produced at all', () => {
    const result = classifyRun(
      observation({
        report: undefined,
        exitCode: 1,
        output: 'Error: connect ECONNREFUSED 127.0.0.1:59999',
      }),
      'anything',
    );
    expect(result.outcome).toBe('INFRA_FAILURE');
  });

  it('a timeout', () => {
    expect(classifyRun(observation({ timedOut: true }), 'anything').outcome).toBe('TIMEOUT');
  });

  it('a filter that matched no test — a manifest error, not a surviving defect', () => {
    const result = classifyRun(
      observation({ report: fixture('no-test-matched'), exitCode: 0 }),
      'no such test name anywhere',
    );
    expect(result.outcome).toBe('NO_TEST_MATCH');
    expect(result.matched).toBe(0);
  });

  it('a source that will not transform: INVALID_MUTANT for a mutant, BUILD failure for a baseline', () => {
    // The distinction matters: a mutation that breaks the parser tells you the edit was not
    // testable, whereas the same failure on the pristine tree means the tree is broken.
    const report = fixture('transform-failed');
    expect(classifyRun(observation({ report, phase: 'mutant' }), 'anything').outcome).toBe(
      'INVALID_MUTANT',
    );
    expect(classifyRun(observation({ report, phase: 'baseline' }), 'anything').outcome).toBe(
      'BUILD_OR_LOAD_FAILURE',
    );
  });

  it('an unrelated test failing while the named test passes', () => {
    const report: VitestReport = {
      testResults: [
        {
          status: 'failed',
          message: '',
          assertionResults: [
            { status: 'passed', fullName: 'suite the named test', failureMessages: [] },
            {
              status: 'failed',
              fullName: 'suite some other test',
              failureMessages: ['AssertionError: expected 1 to be 2'],
            },
          ],
        },
      ],
    };
    const result = classifyRun(observation({ report }), 'the named test');
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(1);
    expect(result.detail).toMatch(/not evidence/u);
  });

  it('the named test being skipped rather than run', () => {
    const report: VitestReport = {
      testResults: [
        {
          status: 'passed',
          message: '',
          assertionResults: [
            { status: 'skipped', fullName: 'suite the named test', failureMessages: [] },
          ],
        },
      ],
    };
    expect(classifyRun(observation({ report, exitCode: 0 }), 'the named test').outcome).toBe(
      'INFRA_FAILURE',
    );
  });
});

describe('a survivor', () => {
  it('is the named test passing under the mutation', () => {
    const report: VitestReport = {
      testResults: [
        {
          status: 'passed',
          message: '',
          assertionResults: [
            { status: 'passed', fullName: 'suite the named test', failureMessages: [] },
          ],
        },
      ],
    };
    const result = classifyRun(observation({ report, exitCode: 0 }), 'the named test');
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(0);
  });
});

describe('the baseline gate', () => {
  it('accepts only a clean pass of the named test', () => {
    const clean: VitestReport = {
      testResults: [
        {
          status: 'passed',
          message: '',
          assertionResults: [
            { status: 'passed', fullName: 'suite the named test', failureMessages: [] },
          ],
        },
      ],
    };
    expect(
      baselineIsUsable(
        classifyRun(
          observation({ report: clean, phase: 'baseline', exitCode: 0 }),
          'the named test',
        ),
      ),
    ).toBe(true);
  });

  it('rejects a baseline where the named test already fails', () => {
    // Without this gate a variant "killed" by an already-red test would be counted as evidence,
    // which is how a broken suite launders itself into a perfect score.
    expect(
      baselineIsUsable(
        classifyRun(
          observation({ report: fixture('named-assertion-failed'), phase: 'baseline' }),
          'fails an assertion',
        ),
      ),
    ).toBe(false);
  });

  it('rejects a baseline that passed the named test but failed another', () => {
    const noisy: VitestReport = {
      testResults: [
        {
          status: 'failed',
          message: '',
          assertionResults: [
            { status: 'passed', fullName: 'suite the named test', failureMessages: [] },
            {
              status: 'failed',
              fullName: 'suite another',
              failureMessages: ['AssertionError: expected 1 to be 2'],
            },
          ],
        },
      ],
    };
    expect(
      baselineIsUsable(
        classifyRun(observation({ report: noisy, phase: 'baseline' }), 'the named test'),
      ),
    ).toBe(false);
  });

  it('rejects every non-test outcome', () => {
    for (const broken of [
      observation({ timedOut: true, phase: 'baseline' }),
      observation({ report: fixture('suite-setup-failed'), phase: 'baseline' }),
      observation({ report: fixture('no-test-matched'), phase: 'baseline', exitCode: 0 }),
      observation({ report: fixture('transform-failed'), phase: 'baseline' }),
    ]) {
      expect(baselineIsUsable(classifyRun(broken, 'anything'))).toBe(false);
    }
  });
});

describe('what the detail line may contain', () => {
  it('is one line and never carries a whole stack', () => {
    const result = classifyRun(
      observation({ report: fixture('named-assertion-failed') }),
      'fails an assertion',
    );
    expect(result.detail).not.toMatch(/\n/u);
    expect(result.detail.length).toBeLessThanOrEqual(260);
  });

  it('strips the escape sequences Vitest embeds in transform errors', () => {
    const result = classifyRun(
      observation({ report: fixture('transform-failed'), phase: 'baseline' }),
      'anything',
    );
    // eslint-disable-next-line no-control-regex -- asserting the absence of escape sequences.
    expect(result.detail).not.toMatch(/\u001B\[/u);
  });
});
