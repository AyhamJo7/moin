/**
 * Classifying a mutation run (QG-09 negative controls, P06.10.07).
 *
 * ## Why this is its own module, and pure
 *
 * Two generations of this decision were wrong, in the same direction both times: generous.
 *
 * The first treated **any** non-zero exit as a kill. Measured: pointing `TEST_DATABASE_ADMIN_URL`
 * at a closed port reported every variant killed, and a manifest entry naming a nonexistent test
 * reported it survived.
 *
 * The second read Vitest's JSON report but decided "was this an assertion?" by matching words in
 * the failure message. Also measured — three of these four were classified `KILLED_ASSERTION`:
 *
 *   Error: database connection refused while executing toThrow assertion
 *   Error: wrapper caught AssertionError from pool
 *   error: syntax error at or near "toStrictEqual"
 *
 * An unreachable database became proof that an invariant was enforced. Message text cannot
 * establish the category, because the text is attacker-shaped by accident: it quotes queries, it
 * quotes matcher names, and it is written for humans.
 *
 * ## What decides it now
 *
 * `scripts/mutation-reporter.ts` reads the live error objects and records what they **are**: the
 * `name`, and whether assertion metadata (`expected`, `actual`, `showDiff`, `ok`) is present as own
 * properties. Every Vitest matcher sets all four; no thrown `Error` has any. This module consumes
 * that and nothing else for the assertion decision.
 *
 * Message text is used for exactly one thing: telling a *timeout* apart from other non-assertion
 * failures, which refines a category that is already not evidence. It can never promote a failure
 * to `KILLED_ASSERTION`.
 */

import type { MutationReport, ReportedTest, TypedError } from './mutation-reporter.ts';

export type {
  MutationReport,
  ReportedModule,
  ReportedTest,
  TypedError,
} from './mutation-reporter.ts';

/** What a single mutation run establishes. Only one of these counts as evidence. */
export type MutationOutcome =
  /** The named test ran and failed with a typed assertion error, and nothing else failed. */
  | 'KILLED_ASSERTION'
  /** The named test ran and passed: the defect is not detected by the test that should catch it. */
  | 'SURVIVED'
  /** The named test did not pass cleanly on the pristine tree, so the mutant proves nothing. */
  | 'BASELINE_FAILED'
  /** The environment failed — unreachable database, revoked grant, hook or global-setup failure. */
  | 'INFRA_FAILURE'
  /** The run exceeded its deadline and was killed. */
  | 'TIMEOUT'
  /** The named test ran and failed by hanging. A real detection, but not an assertion. */
  | 'KILLED_BY_TIMEOUT'
  /** Tests were collected but none matched the filter, which is a manifest error. */
  | 'NO_TEST_MATCH'
  /** A module could not be transformed or loaded on the pristine tree. */
  | 'BUILD_OR_LOAD_FAILURE'
  /** The mutated source could not be transformed or loaded, so the mutation is not testable. */
  | 'INVALID_MUTANT';

export interface RunObservation {
  /** The typed report, or undefined when none was produced or it could not be parsed. */
  readonly report: MutationReport | undefined;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  /** Combined stdout and stderr, used only when there is no report at all. */
  readonly output: string;
  /** Which phase this run belongs to: it changes how a load failure is classified. */
  readonly phase: 'baseline' | 'mutant';
}

export interface Classification {
  readonly outcome: MutationOutcome;
  /** One line, safe to print. */
  readonly detail: string;
  /** Tests whose full name contained the expected test name. */
  readonly matched: number;
  /** Failed tests that were **not** the expected test. */
  readonly unrelatedFailures: number;
}

/**
 * A transform, resolve or load problem.
 *
 * This is matched on text, and that is sound here: it classifies a *module* failure, where there is
 * no error object to inspect, and every branch it reaches is already not evidence. It cannot
 * produce `KILLED_ASSERTION`.
 */
const LOAD_FAILURE =
  /Transform failed|PARSE_ERROR|Failed to load|Cannot find module|Cannot find package|Failed to resolve|SyntaxError|error TS\d+/u;

/**
 * A test that ran out of time rather than asserting.
 *
 * Also text, and also sound for the same reason: it only distinguishes between two outcomes that
 * are both outside the evidence count.
 */
const TEST_TIMEOUT = /^Test timed out in \d+ms/u;

function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  // eslint-disable-next-line no-control-regex -- matching the escape sequences in order to remove them.
  return line.replace(/\u001B\[[0-9;]*m/gu, '').slice(0, 200);
}

function describeError(error: TypedError | undefined): string {
  if (error === undefined) return 'no error was recorded';
  return `${error.name}${error.isAssertion ? ' (typed assertion)' : ''}: ${error.message}`;
}

/**
 * Decide what one run established about one mutation.
 *
 * `expectedTest` is the manifest's `kills` filter; a test counts as the expected one when its full
 * name contains that string, which is exactly how Vitest's `-t` selects it.
 */
export function classifyRun(observation: RunObservation, expectedTest: string): Classification {
  const empty = { matched: 0, unrelatedFailures: 0 } as const;
  const loadOutcome = observation.phase === 'mutant' ? 'INVALID_MUTANT' : 'BUILD_OR_LOAD_FAILURE';

  if (observation.timedOut) {
    return {
      outcome: 'TIMEOUT',
      detail: 'the run exceeded its deadline and was killed, so nothing was established',
      ...empty,
    };
  }

  if (observation.report === undefined) {
    const load = LOAD_FAILURE.test(observation.output);
    return {
      outcome: load ? loadOutcome : 'INFRA_FAILURE',
      detail: load
        ? `no report; a module did not load: ${firstLine(observation.output)}`
        : `no report was produced (exit ${String(observation.exitCode)}): ${firstLine(observation.output)}`,
      ...empty,
    };
  }

  // Global setup and unhandled rejections first: they happen before any test could have run, so
  // nothing a test did or did not do is meaningful.
  const unhandled = observation.report.unhandledErrors[0];
  if (unhandled !== undefined) {
    const load = LOAD_FAILURE.test(unhandled.message);
    return {
      outcome: load ? loadOutcome : 'INFRA_FAILURE',
      detail: `the run failed outside any test: ${describeError(unhandled)}`,
      ...empty,
    };
  }

  const modules = observation.report.modules;

  const moduleError = modules.flatMap((module) => module.errors)[0];
  if (moduleError !== undefined) {
    return {
      outcome: LOAD_FAILURE.test(moduleError.message) ? loadOutcome : 'INFRA_FAILURE',
      detail: `a module failed to load or run: ${describeError(moduleError)}`,
      ...empty,
    };
  }

  // A hook that threw is infrastructure, whatever it says. This is the case that used to be counted
  // as a kill: an unreachable database fails `beforeAll`, every test is skipped, the process exits
  // non-zero.
  const hookError = modules.flatMap((module) => module.hookErrors)[0];
  if (hookError !== undefined) {
    return {
      outcome: LOAD_FAILURE.test(hookError.message) ? loadOutcome : 'INFRA_FAILURE',
      detail: `a suite hook failed before or around its tests: ${describeError(hookError)}`,
      ...empty,
    };
  }

  const tests: readonly ReportedTest[] = modules.flatMap((module) => module.tests);
  const named = tests.filter((test) => test.fullName.includes(expectedTest));

  if (named.length === 0) {
    // "The filter matched nothing" and "no tests were collected" are different failures, and
    // conflating them hid suites that never loaded.
    if (tests.length === 0) {
      return {
        outcome: 'INFRA_FAILURE',
        detail:
          'the run collected no tests at all, so it never reached the filter — a setup or global ' +
          'fixture failed before any suite ran',
        ...empty,
      };
    }
    return {
      outcome: 'NO_TEST_MATCH',
      detail: `no test's name contained "${expectedTest}", so the manifest names a test that does not exist`,
      matched: 0,
      unrelatedFailures: tests.filter((test) => test.state === 'failed').length,
    };
  }

  const unrelatedFailures = tests.filter(
    (test) => test.state === 'failed' && !test.fullName.includes(expectedTest),
  ).length;

  const failedNamed = named.filter((test) => test.state === 'failed');
  if (failedNamed.length > 0) {
    const errors = failedNamed.flatMap((test) => test.errors);

    // Fail closed when a test carries a non-assertion error alongside an assertion one — an
    // `afterEach` that threw, for instance. The assertion may be genuine, but the run is not clean
    // evidence and saying so is cheap.
    const nonAssertion = errors.filter((error) => !error.isAssertion);
    if (errors.length > 0 && nonAssertion.length === 0) {
      return {
        outcome: 'KILLED_ASSERTION',
        detail: `the named test ran and rejected the mutation — ${describeError(errors[0])}`,
        matched: named.length,
        unrelatedFailures,
      };
    }

    const timedOut = nonAssertion.find((error) => TEST_TIMEOUT.test(error.message));
    if (timedOut !== undefined) {
      // A real detection, and weaker evidence than an assertion: the mutation made the code hang,
      // so the test never rejected anything. Reported as itself.
      return {
        outcome: 'KILLED_BY_TIMEOUT',
        detail: `the mutation made the code hang: ${describeError(timedOut)}`,
        matched: named.length,
        unrelatedFailures,
      };
    }

    const mixed = errors.length > nonAssertion.length;
    return {
      outcome: 'INFRA_FAILURE',
      detail: mixed
        ? `the named test failed with an assertion AND a non-assertion error, so the run is not clean evidence — ${describeError(nonAssertion[0])}`
        : `the named test ran but failed with no typed assertion — ${describeError(nonAssertion[0] ?? errors[0])}`,
      matched: named.length,
      unrelatedFailures,
    };
  }

  // The named test did not fail. If it never ran either, the run says nothing about it.
  if (!named.some((test) => test.state === 'passed')) {
    return {
      outcome: 'INFRA_FAILURE',
      detail: `the named test neither passed nor failed (state: ${named[0]?.state ?? 'unknown'}), so it did not run`,
      matched: named.length,
      unrelatedFailures,
    };
  }

  return {
    outcome: 'SURVIVED',
    detail:
      unrelatedFailures > 0
        ? `the named test passed under the mutation; ${String(unrelatedFailures)} unrelated test(s) failed, which is not evidence`
        : 'the named test passed under the mutation, so it does not detect this defect',
    matched: named.length,
    unrelatedFailures,
  };
}

/** A baseline is usable only when the named test actually ran and passed, and nothing else failed. */
export function baselineIsUsable(classification: Classification): boolean {
  return classification.outcome === 'SURVIVED' && classification.unrelatedFailures === 0;
}
