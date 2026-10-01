/**
 * The mutation classifier, checked (P06.10.07).
 *
 * The harness that produces mutation evidence is itself a control, and it has been wrong twice —
 * both times generous. First it counted any non-zero exit as a kill. Then it read the structured
 * report but decided "was this an assertion?" from the words in the failure message, so an
 * ordinary error reading `database connection refused while executing toThrow assertion` was
 * counted as proof that an invariant was enforced.
 *
 * The cases below are therefore adversarial on purpose: every one of the first four is an ordinary
 * error whose *text* would pass a word-matching classifier, and all four must be rejected. The
 * decision is made on typed metadata that the reporter reads from the live error object, and these
 * fixtures reproduce exactly what it records — verified against real Vitest runs for the assertion,
 * thrown-error, hook-failure and timeout shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  baselineIsUsable,
  classifyRun,
  type MutationReport,
  type RunObservation,
  type TypedError,
} from './mutation-outcome.ts';

/** A typed assertion error, exactly as the reporter records one. */
function assertionError(message = 'expected 1 to be 2 // Object.is equality'): TypedError {
  return {
    name: 'AssertionError',
    isAssertion: true,
    assertionFields: ['expected', 'actual', 'showDiff', 'ok'],
    message,
  };
}

/**
 * A thrown `Error`, exactly as the reporter records one: no assertion fields, whatever the text.
 *
 * `name` is a parameter because an ordinary error can be given any name, and the classifier must
 * not be fooled by that either.
 */
function thrownError(message: string, name = 'Error'): TypedError {
  return { name, isAssertion: false, assertionFields: [], message };
}

function report(overrides: Partial<MutationReport> = {}): MutationReport {
  return { unhandledErrors: [], modules: [], ...overrides };
}

function moduleWith(
  tests: readonly { name: string; state: string; errors?: readonly TypedError[] }[],
  extras: { hookErrors?: readonly TypedError[]; errors?: readonly TypedError[] } = {},
): MutationReport {
  return report({
    modules: [
      {
        moduleId: '/repo/suite.integration.test.ts',
        state: tests.some((test) => test.state === 'failed') ? 'failed' : 'passed',
        errors: extras.errors ?? [],
        hookErrors: extras.hookErrors ?? [],
        tests: tests.map((test) => ({
          fullName: test.name,
          state: test.state,
          errors: test.errors ?? [],
        })),
      },
    ],
  });
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

const NAMED = 'the named test';

describe('message text cannot promote a failure to evidence', () => {
  // Each of these is an ordinary thrown error. A word-matching classifier called three of the four
  // KILLED_ASSERTION; none of them is one.
  const impostors: readonly { readonly label: string; readonly error: TypedError }[] = [
    {
      label: 'a connection failure that happens to mention toThrow',
      error: thrownError('database connection refused while executing toThrow assertion'),
    },
    {
      label: 'an ordinary error quoting an expect() call',
      error: thrownError('expect(value).toBe(true) could not run'),
    },
    {
      label: 'an ordinary error containing the word AssertionError',
      error: thrownError('wrapper caught AssertionError from the pool'),
    },
    {
      label: 'a SQL error whose query text contains matcher words',
      error: thrownError('syntax error at or near "toStrictEqual"'),
    },
    {
      label: 'an ordinary error whose name was reassigned to AssertionError',
      error: thrownError('connection reset', 'AssertionError'),
    },
  ];

  for (const impostor of impostors) {
    it(`rejects ${impostor.label}`, () => {
      const result = classifyRun(
        observation({
          report: moduleWith([
            { name: `suite ${NAMED}`, state: 'failed', errors: [impostor.error] },
          ]),
        }),
        NAMED,
      );
      expect(result.outcome).not.toBe('KILLED_ASSERTION');
      expect(result.outcome).toBe('INFRA_FAILURE');
    });
  }

  it('accepts a typed assertion error from the intended test', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([
          { name: `suite ${NAMED}`, state: 'failed', errors: [assertionError()] },
        ]),
      }),
      NAMED,
    );
    expect(result.outcome).toBe('KILLED_ASSERTION');
    expect(result.matched).toBe(1);
    expect(result.unrelatedFailures).toBe(0);
  });

  it('requires the assertion metadata, not just the name', () => {
    // Half-typed: the right name, but none of the fields a matcher sets. Fails closed.
    const halfTyped: TypedError = {
      name: 'AssertionError',
      isAssertion: false,
      assertionFields: ['expected'],
      message: 'expected 1 to be 2',
    };
    expect(
      classifyRun(
        observation({
          report: moduleWith([{ name: `suite ${NAMED}`, state: 'failed', errors: [halfTyped] }]),
        }),
        NAMED,
      ).outcome,
    ).toBe('INFRA_FAILURE');
  });
});

describe('whose test failed matters', () => {
  it('rejects a typed assertion from an unrelated test while the intended one passes', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([
          { name: `suite ${NAMED}`, state: 'passed' },
          { name: 'suite some other test', state: 'failed', errors: [assertionError()] },
        ]),
      }),
      NAMED,
    );
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(1);
    expect(result.detail).toMatch(/not evidence/u);
  });

  it('rejects a run where the named test never ran', () => {
    expect(
      classifyRun(
        observation({
          report: moduleWith([{ name: `suite ${NAMED}`, state: 'skipped' }]),
          exitCode: 0,
        }),
        NAMED,
      ).outcome,
    ).toBe('INFRA_FAILURE');
  });

  it('reports a filter that matched nothing as a manifest error', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([{ name: 'suite something else entirely', state: 'skipped' }]),
        exitCode: 0,
      }),
      NAMED,
    );
    expect(result.outcome).toBe('NO_TEST_MATCH');
    expect(result.matched).toBe(0);
  });

  it('separates "no tests collected" from "the filter matched nothing"', () => {
    expect(classifyRun(observation({ report: moduleWith([]) }), NAMED).outcome).toBe(
      'INFRA_FAILURE',
    );
  });
});

describe('infrastructure never counts, however it presents', () => {
  it('a beforeAll failure is infrastructure', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([{ name: `suite ${NAMED}`, state: 'skipped' }], {
          hookErrors: [thrownError('connect ECONNREFUSED 127.0.0.1:59999')],
        }),
      }),
      NAMED,
    );
    expect(result.outcome).toBe('INFRA_FAILURE');
    expect(result.detail).toMatch(/hook/u);
  });

  it('a hook failure wins even when it mentions a matcher', () => {
    expect(
      classifyRun(
        observation({
          report: moduleWith(
            [{ name: `suite ${NAMED}`, state: 'failed', errors: [assertionError()] }],
            {
              hookErrors: [thrownError('teardown failed while running toThrow')],
            },
          ),
        }),
        NAMED,
      ).outcome,
    ).toBe('INFRA_FAILURE');
  });

  it('a global setup failure is infrastructure', () => {
    expect(
      classifyRun(
        observation({
          report: report({ unhandledErrors: [thrownError('global setup: database unreachable')] }),
        }),
        NAMED,
      ).outcome,
    ).toBe('INFRA_FAILURE');
  });

  it('an afterEach failure alongside an assertion fails closed', () => {
    // Measured shape: Vitest attaches both errors to the same test. The assertion may be genuine,
    // but the run is not clean evidence.
    const result = classifyRun(
      observation({
        report: moduleWith([
          {
            name: `suite ${NAMED}`,
            state: 'failed',
            errors: [assertionError(), thrownError('teardown blew up')],
          },
        ]),
      }),
      NAMED,
    );
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
    expect(result.outcome).toBe('INFRA_FAILURE');
    expect(result.detail).toMatch(/not clean evidence/u);
  });

  it('an unreachable database with no report at all is infrastructure', () => {
    expect(
      classifyRun(observation({ output: 'Error: connect ECONNREFUSED 127.0.0.1:59999' }), NAMED)
        .outcome,
    ).toBe('INFRA_FAILURE');
  });

  it('a module that would not load is a build failure, or an invalid mutant', () => {
    const broken = moduleWith([], { errors: [thrownError('Transform failed with 1 error')] });
    expect(classifyRun(observation({ report: broken, phase: 'mutant' }), NAMED).outcome).toBe(
      'INVALID_MUTANT',
    );
    expect(classifyRun(observation({ report: broken, phase: 'baseline' }), NAMED).outcome).toBe(
      'BUILD_OR_LOAD_FAILURE',
    );
  });
});

describe('timeouts', () => {
  it('a killed process is a TIMEOUT and establishes nothing', () => {
    expect(classifyRun(observation({ timedOut: true }), NAMED).outcome).toBe('TIMEOUT');
  });

  it('a named test that hung is reported as such, not as an assertion', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([
          {
            name: `suite ${NAMED}`,
            state: 'failed',
            errors: [thrownError('Test timed out in 30000ms.')],
          },
        ]),
      }),
      NAMED,
    );
    expect(result.outcome).toBe('KILLED_BY_TIMEOUT');
    expect(result.outcome).not.toBe('KILLED_ASSERTION');
  });
});

describe('a survivor', () => {
  it('is the named test passing under the mutation', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([{ name: `suite ${NAMED}`, state: 'passed' }]),
        exitCode: 0,
      }),
      NAMED,
    );
    expect(result.outcome).toBe('SURVIVED');
    expect(result.unrelatedFailures).toBe(0);
  });
});

describe('the baseline gate', () => {
  it('accepts only a clean pass of the named test', () => {
    expect(
      baselineIsUsable(
        classifyRun(
          observation({
            report: moduleWith([{ name: `suite ${NAMED}`, state: 'passed' }]),
            phase: 'baseline',
            exitCode: 0,
          }),
          NAMED,
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
          observation({
            report: moduleWith([
              { name: `suite ${NAMED}`, state: 'failed', errors: [assertionError()] },
            ]),
            phase: 'baseline',
          }),
          NAMED,
        ),
      ),
    ).toBe(false);
  });

  it('rejects a baseline that passed the named test but failed another', () => {
    expect(
      baselineIsUsable(
        classifyRun(
          observation({
            report: moduleWith([
              { name: `suite ${NAMED}`, state: 'passed' },
              { name: 'suite another', state: 'failed', errors: [assertionError()] },
            ]),
            phase: 'baseline',
          }),
          NAMED,
        ),
      ),
    ).toBe(false);
  });

  it('rejects every non-test outcome', () => {
    for (const broken of [
      observation({ timedOut: true, phase: 'baseline' }),
      observation({
        report: moduleWith([{ name: `suite ${NAMED}`, state: 'skipped' }], {
          hookErrors: [thrownError('connect ECONNREFUSED')],
        }),
        phase: 'baseline',
      }),
      observation({ report: moduleWith([]), phase: 'baseline' }),
      observation({
        report: moduleWith([], { errors: [thrownError('Transform failed with 1 error')] }),
        phase: 'baseline',
      }),
      observation({ report: undefined, output: 'ECONNREFUSED', phase: 'baseline' }),
    ]) {
      expect(baselineIsUsable(classifyRun(broken, NAMED))).toBe(false);
    }
  });
});

describe('the detail line', () => {
  it('is one line, and names the error type it decided on', () => {
    const result = classifyRun(
      observation({
        report: moduleWith([
          { name: `suite ${NAMED}`, state: 'failed', errors: [assertionError()] },
        ]),
      }),
      NAMED,
    );
    expect(result.detail).not.toMatch(/\n/u);
    expect(result.detail).toMatch(/AssertionError \(typed assertion\)/u);
  });
});
