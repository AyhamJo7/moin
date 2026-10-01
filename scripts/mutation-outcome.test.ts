/**
 * The mutation classifier, checked adversarially (P06.10.07).
 *
 * The harness that produces mutation evidence is itself a control, and it has been wrong four
 * times, always generously: counting any non-zero exit as a kill; matching words in the failure
 * message; accepting an ordinary `Error` decorated with `name = 'AssertionError'` and four matcher
 * fields; and matching the intended test by substring with no file identity, so a same-named test
 * in another file — or two tests at once — could claim the kill.
 *
 * So these are written as attacks. The classifier consumes only the trusted reporter's
 * `failureCategory` and an exact `{ file, fullName }` identity; it never inspects an error. The
 * reporter's own tests pin the signals that category rests on, and
 * `mutation-reporter.integration.test.ts` pins them against real Vitest.
 */
import { describe, expect, it } from 'vitest';
import {
  baselineIsUsable,
  classifyRun,
  type KillingTest,
  type MutationReport,
  type ReportedError,
  type ReportedTest,
  type RunObservation,
} from './mutation-outcome.ts';
import { categoriseTest, REPORT_VERSION } from './mutation-reporter.ts';

const FILE = 'packages/db/src/chain.integration.test.ts';
const OTHER_FILE = 'packages/db/src/other.integration.test.ts';
const NAME = 'the chain > rejects invalid chain';
const INTENDED: KillingTest = { file: FILE, fullName: NAME };

/** As the reporter emits a genuine, trusted assertion failure. */
function assertionError(message = 'expected 1 to be 2'): ReportedError {
  return {
    name: 'AssertionError',
    foreignMarkers: [],
    assertionFields: ['expected', 'actual', 'showDiff', 'ok'],
    category: 'ASSERTION',
    message,
  };
}

/**
 * As the reporter emits an ordinary error — including one decorated to look like an assertion.
 *
 * The decoration is the point: `name` and the four fields are whatever the test set, and Vitest's
 * serializer adds `constructor`/`toString` because the object is not one of its own. The reporter
 * therefore categorises it `ERROR`, and this module never second-guesses that.
 */
function thrownError(message: string, decorated = false): ReportedError {
  return {
    name: decorated ? 'AssertionError' : 'Error',
    foreignMarkers: ['constructor', 'toString'],
    assertionFields: decorated ? ['expected', 'actual', 'showDiff', 'ok'] : [],
    category: 'ERROR',
    message,
  };
}

function test(
  fullName: string,
  state: string,
  options: { file?: string; errors?: readonly ReportedError[] } = {},
): ReportedTest {
  const errors = options.errors ?? [];
  // Categorised by the **reporter's own function**, not by a rule copied into this file. A
  // fixture that re-implements the thing under test only proves the copy agrees with itself.
  const probe = {
    version: 1,
    // A genuine assertion means `expect` was called; a thrown object means it was not. These are
    // the measured shapes the reporter's own tests pin.
    expectCalls: errors.some((error) => error.category === 'ASSERTION') ? 1 : 0,
    recordedErrors: errors.length,
  };
  return {
    file: options.file ?? FILE,
    fullName,
    state,
    executed: state === 'passed' || state === 'failed',
    failureCategory: state === 'failed' ? categoriseTest(errors, probe) : undefined,
    probe,
    errors,
  };
}

function report(
  tests: readonly ReportedTest[],
  extras: {
    hookErrors?: readonly ReportedError[];
    moduleErrors?: readonly ReportedError[];
    unhandledErrors?: readonly ReportedError[];
    reportVersion?: number;
  } = {},
): MutationReport {
  const byFile = new Map<string, ReportedTest[]>();
  for (const entry of tests) {
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  }
  if (byFile.size === 0) byFile.set(FILE, []);
  return {
    reportVersion: extras.reportVersion ?? REPORT_VERSION,
    probeVersion: 1,
    unhandledErrors: extras.unhandledErrors ?? [],
    modules: [...byFile.entries()].map(([file, entries]) => ({
      file,
      state: entries.some((entry) => entry.state === 'failed') ? 'failed' : 'passed',
      errors: extras.moduleErrors ?? [],
      hookErrors: extras.hookErrors ?? [],
      tests: entries,
    })),
  };
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

function classify(reportValue: MutationReport, identity: KillingTest = INTENDED) {
  return classifyRun(observation({ report: reportValue }), identity);
}

describe('1 — a spoofed assertion object', () => {
  it('is not evidence, however it is decorated', () => {
    // The latest exploit: an ordinary Error with name = AssertionError and expected/actual/
    // showDiff/ok. The reporter categorises it ERROR because `expect` was never called and Vitest
    // marked it foreign; this module takes that verdict and does not look at the fields.
    const result = classify(
      report([test(NAME, 'failed', { errors: [thrownError('connection refused', true)] })]),
    );
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
    expect(result.outcome).toBe('INFRA_FAILURE');
  });
});

describe('2 — the same test name in another file', () => {
  it('cannot claim the kill', () => {
    const result = classify(
      report([test(NAME, 'failed', { file: OTHER_FILE, errors: [assertionError()] })]),
    );
    expect(result.outcome).toBe('NO_TEST_MATCH');
    expect(result.matched).toBe(0);
  });

  it('is distinguished from the intended file when both exist', () => {
    // File identity is what resolves this: the intended test passed, the namesake failed.
    const result = classify(
      report([
        test(NAME, 'passed'),
        test(NAME, 'failed', { file: OTHER_FILE, errors: [assertionError()] }),
      ]),
    );
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
    expect(result.matched).toBe(1);
    expect(result.unrelatedFailures).toBe(1);
  });
});

describe('3 — duplicate identity', () => {
  it('is rejected rather than resolved arbitrarily', () => {
    const result = classify(
      report([test(NAME, 'passed'), test(NAME, 'failed', { errors: [assertionError()] })]),
    );
    expect(result.outcome).toBe('AMBIGUOUS_TEST_IDENTITY');
    expect(result.matched).toBe(2);
  });
});

describe('4 — a substring collision', () => {
  it('does not match a longer name that contains the intended one', () => {
    const result = classify(
      report([test(`${NAME} after retry`, 'failed', { errors: [assertionError()] })]),
    );
    expect(result.outcome).toBe('NO_TEST_MATCH');
  });

  it('does not match a shorter name contained by the intended one', () => {
    const result = classify(
      report([test('the chain > rejects invalid', 'failed', { errors: [assertionError()] })]),
    );
    expect(result.outcome).toBe('NO_TEST_MATCH');
  });
});

describe('5 — the intended test asserts, something unrelated throws', () => {
  it('is not a clean kill', () => {
    const result = classify(
      report([
        test(NAME, 'failed', { errors: [assertionError()] }),
        test('the chain > something else', 'failed', { errors: [thrownError('pool exhausted')] }),
      ]),
    );
    expect(result.outcome).toBe('UNRELATED_FAILURE');
    expect(result.unrelatedFailures).toBe(1);
  });
});

describe('6 — the intended test asserts, something unrelated also asserts', () => {
  it('is still not a clean kill', () => {
    const result = classify(
      report([
        test(NAME, 'failed', { errors: [assertionError()] }),
        test('the chain > another assertion', 'failed', { errors: [assertionError()] }),
      ]),
    );
    expect(result.outcome).toBe('UNRELATED_FAILURE');
  });
});

describe('7 — the intended test passes while another fails', () => {
  it('is not a kill', () => {
    const result = classify(
      report([
        test(NAME, 'passed'),
        test('the chain > another', 'failed', { errors: [assertionError()] }),
      ]),
    );
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(1);
  });
});

describe('8 — a global setup failure', () => {
  it('is infrastructure', () => {
    const result = classify(
      report([], { unhandledErrors: [thrownError('global setup: database unreachable')] }),
    );
    expect(result.outcome).toBe('INFRA_FAILURE');
    expect(result.detail).toMatch(/outside any test/u);
  });
});

describe('9 — a beforeAll failure', () => {
  it('is a hook failure, not a kill', () => {
    const result = classify(
      report([test(NAME, 'skipped')], {
        hookErrors: [thrownError('connect ECONNREFUSED 127.0.0.1:59999')],
      }),
    );
    expect(result.outcome).toBe('HOOK_FAILURE');
  });

  it('wins even when a test also recorded an assertion', () => {
    const result = classify(
      report([test(NAME, 'failed', { errors: [assertionError()] })], {
        hookErrors: [thrownError('teardown failed')],
      }),
    );
    expect(result.outcome).toBe('HOOK_FAILURE');
  });
});

describe('10 — an afterEach failure', () => {
  it('disqualifies the kill even though the intended test asserted', () => {
    // Measured shape: Vitest attaches both errors to the same test, so the reporter sees a foreign
    // error among them and refuses to call the failure an assertion.
    const result = classify(
      report([
        test(NAME, 'failed', { errors: [assertionError(), thrownError('teardown blew up')] }),
      ]),
    );
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
    expect(result.outcome).toBe('INFRA_FAILURE');
  });
});

describe('11 — the reporter wrote nothing', () => {
  it('is a reporter failure, not a kill', () => {
    const result = classifyRun(
      observation({ report: undefined, output: 'vitest crashed' }),
      INTENDED,
    );
    expect(result.outcome).toBe('REPORTER_FAILURE');
  });
});

describe('12 — malformed reporter output', () => {
  it('is rejected when the shape is wrong', () => {
    const malformed = {
      reportVersion: REPORT_VERSION,
      probeVersion: 1,
    } as unknown as MutationReport;
    expect(classifyRun(observation({ report: malformed }), INTENDED).outcome).toBe(
      'REPORTER_FAILURE',
    );
  });

  it('is rejected when the version is not the one this classifier understands', () => {
    const stale = report([test(NAME, 'failed', { errors: [assertionError()] })], {
      reportVersion: REPORT_VERSION - 1,
    });
    expect(classify(stale).outcome).toBe('REPORTER_FAILURE');
  });
});

describe('13 — truncated reporter output', () => {
  it('is rejected when modules are missing', () => {
    const truncated = {
      reportVersion: REPORT_VERSION,
      probeVersion: 1,
      unhandledErrors: [],
    } as unknown as MutationReport;
    expect(classifyRun(observation({ report: truncated }), INTENDED).outcome).toBe(
      'REPORTER_FAILURE',
    );
  });
});

describe('14 — an exact, clean kill', () => {
  it('is the only shape that counts', () => {
    const result = classify(
      report([
        test(NAME, 'failed', { errors: [assertionError()] }),
        test('the chain > an unrelated passing test', 'passed'),
        test(NAME, 'skipped', { file: OTHER_FILE }),
      ]),
    );
    expect(result.outcome).toBe('KILLED_ASSERTION');
    expect(result.matched).toBe(1);
    expect(result.unrelatedFailures).toBe(0);
    expect(result.detail).toMatch(/trusted assertion/u);
  });
});

describe('15 — a survivor', () => {
  it('is the intended test passing under the mutation', () => {
    const result = classify(report([test(NAME, 'passed')]));
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(0);
  });
});

describe('16 — a renamed test', () => {
  it('no longer matches, and is reported as such', () => {
    const result = classify(report([test('the chain > rejects a malformed chain', 'passed')]));
    expect(result.outcome).toBe('NO_TEST_MATCH');
  });
});

describe('17 — parameterized cases', () => {
  const generated = [
    'kinds > catches a uuid kind holding a boolean',
    'kinds > catches a uuid kind holding a number',
    'kinds > catches a count kind holding a boolean',
  ];

  it('binds to exactly one generated case, not to its siblings', () => {
    const intended: KillingTest = { file: FILE, fullName: generated[0] ?? '' };
    const result = classifyRun(
      observation({
        report: report([
          test(generated[0] ?? '', 'failed', { errors: [assertionError()] }),
          test(generated[1] ?? '', 'passed'),
          test(generated[2] ?? '', 'passed'),
        ]),
      }),
      intended,
    );
    expect(result.outcome).toBe('KILLED_ASSERTION');
    expect(result.matched).toBe(1);
  });

  it('does not bind to a sibling that fails instead', () => {
    const intended: KillingTest = { file: FILE, fullName: generated[0] ?? '' };
    const result = classifyRun(
      observation({
        report: report([
          test(generated[0] ?? '', 'passed'),
          test(generated[1] ?? '', 'failed', { errors: [assertionError()] }),
        ]),
      }),
      intended,
    );
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
    expect(result.unrelatedFailures).toBe(1);
  });
});

describe('18 — the same exact name in two modules', () => {
  it('is disambiguated by the manifest file', () => {
    const shared = report([
      test(NAME, 'failed', { errors: [assertionError()] }),
      test(NAME, 'passed', { file: OTHER_FILE }),
    ]);
    expect(classify(shared, { file: FILE, fullName: NAME }).outcome).toBe('KILLED_ASSERTION');
    // Pointing the manifest at the other file selects the namesake that passed, so the same
    // report yields a survivor — which is the proof that the file half of the identity is
    // load-bearing.
    const other = classify(shared, { file: OTHER_FILE, fullName: NAME });
    expect(other.outcome).toBe('SURVIVED');
    expect(other.matched).toBe(1);
    expect(other.unrelatedFailures).toBe(1);
  });
});

describe('timeouts', () => {
  it('a killed process establishes nothing', () => {
    expect(classifyRun(observation({ timedOut: true }), INTENDED).outcome).toBe('TIMEOUT');
  });

  it('a hung intended test is reported as such, not as an assertion', () => {
    const hung = report([
      {
        ...test(NAME, 'failed'),
        failureCategory: 'TIMEOUT' as const,
        errors: [{ ...thrownError('Test timed out in 30000ms.'), category: 'TIMEOUT' as const }],
      },
    ]);
    const result = classify(hung);
    expect(result.outcome).toBe('KILLED_BY_TIMEOUT');
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
  });
});

describe('load failures', () => {
  it('are an invalid mutant in the mutant phase and a build failure in the baseline', () => {
    const broken = report([], {
      moduleErrors: [
        { ...thrownError('Transform failed with 1 error'), category: 'LOAD' as const },
      ],
    });
    expect(classifyRun(observation({ report: broken, phase: 'mutant' }), INTENDED).outcome).toBe(
      'INVALID_MUTANT',
    );
    expect(classifyRun(observation({ report: broken, phase: 'baseline' }), INTENDED).outcome).toBe(
      'BUILD_OR_LOAD_FAILURE',
    );
  });
});

describe('the baseline gate', () => {
  it('accepts only a unique, clean pass of the intended test', () => {
    expect(
      baselineIsUsable(
        classifyRun(
          observation({ report: report([test(NAME, 'passed')]), phase: 'baseline', exitCode: 0 }),
          INTENDED,
        ),
      ),
    ).toBe(true);
  });

  it('rejects a baseline with any unrelated failure', () => {
    expect(
      baselineIsUsable(
        classifyRun(
          observation({
            report: report([
              test(NAME, 'passed'),
              test('the chain > another', 'failed', { errors: [assertionError()] }),
            ]),
            phase: 'baseline',
          }),
          INTENDED,
        ),
      ).valueOf(),
    ).toBe(false);
  });

  it('rejects every non-passing baseline shape', () => {
    for (const broken of [
      observation({ timedOut: true, phase: 'baseline' }),
      observation({
        report: report([test(NAME, 'failed', { errors: [assertionError()] })]),
        phase: 'baseline',
      }),
      observation({ report: report([test(NAME, 'skipped')]), phase: 'baseline' }),
      observation({ report: report([]), phase: 'baseline' }),
      observation({ report: undefined, output: 'ECONNREFUSED', phase: 'baseline' }),
      observation({
        report: report([test(NAME, 'passed'), test(NAME, 'passed')]),
        phase: 'baseline',
      }),
    ]) {
      expect(baselineIsUsable(classifyRun(broken, INTENDED))).toBe(false);
    }
  });
});
