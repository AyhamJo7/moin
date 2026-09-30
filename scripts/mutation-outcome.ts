/**
 * Classifying a mutation run (QG-09 negative controls, P06.10.07).
 *
 * ## Why this is its own module, and pure
 *
 * The previous runner treated **any** non-zero exit as `KILLED`. Measured: pointing
 * `TEST_DATABASE_ADMIN_URL` at a closed port reported every variant as killed, and a manifest entry
 * naming a test that does not exist reported `SURVIVED`. Neither run proved anything about the
 * invariant, and "54/54 killed" was therefore not evidence — it was a count of failures of any kind.
 *
 * A mutation is killed only when **the named invariant-bearing test actually ran and rejected the
 * mutated behaviour**. Distinguishing that from an unreachable database, a transform error, a
 * timeout, a filter that matched nothing, or an unrelated failure needs the runner's structured
 * report rather than its exit code — so the decision lives here, as a function over that report,
 * where it can be tested against captured shapes instead of trusted.
 */

/** What a single mutation run establishes. Only one of these counts as evidence. */
export type MutationOutcome =
  /** The named test ran and failed on an assertion. The only outcome that is evidence. */
  | 'KILLED_ASSERTION'
  /** The named test ran and passed: the defect is not detected by the test that should catch it. */
  | 'SURVIVED'
  /** The named test did not pass on the pristine tree, so the mutant proves nothing. */
  | 'BASELINE_FAILED'
  /** The environment failed — unreachable database, revoked grant, connection reset. */
  | 'INFRA_FAILURE'
  /** The run exceeded its deadline and was killed. */
  | 'TIMEOUT'
  /** The filter matched no test, which is a manifest error. */
  | 'NO_TEST_MATCH'
  /** A suite could not be transformed or loaded on the pristine tree. */
  | 'BUILD_OR_LOAD_FAILURE'
  /** The mutated source could not be transformed or loaded, so the mutation is not testable. */
  | 'INVALID_MUTANT';

/** The subset of Vitest's JSON report this decision needs. */
export interface VitestAssertion {
  readonly status?: string;
  readonly fullName?: string;
  readonly title?: string;
  readonly failureMessages?: readonly string[];
}

export interface VitestSuite {
  readonly status?: string;
  readonly message?: string;
  readonly name?: string;
  readonly assertionResults?: readonly VitestAssertion[];
}

export interface VitestReport {
  readonly success?: boolean;
  readonly numTotalTests?: number;
  readonly numFailedTests?: number;
  readonly testResults?: readonly VitestSuite[];
}

export interface RunObservation {
  /** Parsed JSON report, or undefined when none was produced or it could not be parsed. */
  readonly report: VitestReport | undefined;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  /** Combined stdout and stderr, used only when there is no report to read. */
  readonly output: string;
  /** Which phase this run belongs to: it changes how a load failure is classified. */
  readonly phase: 'baseline' | 'mutant';
}

export interface Classification {
  readonly outcome: MutationOutcome;
  /** One line, safe to print: never a stored value, never a driver message beyond its first line. */
  readonly detail: string;
  /** Assertions whose full name contained the expected test name. */
  readonly matched: number;
  /** Failed assertions that were **not** the expected test. */
  readonly unrelatedFailures: number;
}

/**
 * A transform, resolve or load problem rather than a test outcome.
 *
 * Matched on Vitest's own wording. Kept narrow on purpose: anything not recognised here falls
 * through to `INFRA_FAILURE`, which is the safe direction — it is never counted as evidence.
 */
const LOAD_FAILURE =
  /Transform failed|PARSE_ERROR|Failed to load|Cannot find module|Cannot find package|Error: Failed to resolve|SyntaxError|Unexpected token|error TS\d+/u;

/** An assertion rejecting a value, as opposed to the test dying of something else. */
const ASSERTION_FAILURE = /AssertionError|expected .* to |toStrictEqual|toMatchObject|toThrow/u;

function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  // Strip ANSI, which Vitest embeds in transform errors.
  // eslint-disable-next-line no-control-regex -- matching the escape sequences in order to remove them.
  return line.replace(/\u001B\[[0-9;]*m/gu, '').slice(0, 200);
}

/**
 * Decide what one run established about one mutation.
 *
 * `expectedTest` is the manifest's `kills` filter; an assertion counts as the expected test when
 * its full name contains that string, which is exactly how Vitest's `-t` selects it.
 */
export function classifyRun(observation: RunObservation, expectedTest: string): Classification {
  const empty = { matched: 0, unrelatedFailures: 0 } as const;

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
      outcome: load
        ? observation.phase === 'mutant'
          ? 'INVALID_MUTANT'
          : 'BUILD_OR_LOAD_FAILURE'
        : 'INFRA_FAILURE',
      detail: load
        ? `no report; the suite did not load: ${firstLine(observation.output)}`
        : `no report was produced (exit ${String(observation.exitCode)}): ${firstLine(observation.output)}`,
      ...empty,
    };
  }

  const suites = observation.report.testResults ?? [];

  // A suite that failed *before* its tests is not a test outcome. This is the case that used to be
  // counted as a kill: an unreachable database fails `beforeAll`, every assertion is skipped, and
  // the process exits non-zero.
  const brokenSuite = suites.find(
    (suite) => suite.status === 'failed' && (suite.message ?? '').trim().length > 0,
  );
  if (brokenSuite !== undefined) {
    const message = brokenSuite.message ?? '';
    const load = LOAD_FAILURE.test(message);
    return {
      outcome: load
        ? observation.phase === 'mutant'
          ? 'INVALID_MUTANT'
          : 'BUILD_OR_LOAD_FAILURE'
        : 'INFRA_FAILURE',
      detail: `${load ? 'the suite did not load' : 'the suite failed before its tests'}: ${firstLine(message)}`,
      ...empty,
    };
  }

  const assertions = suites.flatMap((suite) => suite.assertionResults ?? []);
  const named = assertions.filter((assertion) =>
    (assertion.fullName ?? assertion.title ?? '').includes(expectedTest),
  );

  if (named.length === 0) {
    return {
      outcome: 'NO_TEST_MATCH',
      detail: `no test's name contained "${expectedTest}", so the manifest names a test that does not exist`,
      matched: 0,
      unrelatedFailures: assertions.filter((assertion) => assertion.status === 'failed').length,
    };
  }

  const unrelatedFailures = assertions.filter(
    (assertion) =>
      assertion.status === 'failed' &&
      !(assertion.fullName ?? assertion.title ?? '').includes(expectedTest),
  ).length;

  const failedNamed = named.filter((assertion) => assertion.status === 'failed');
  if (failedNamed.length > 0) {
    const messages = failedNamed.flatMap((assertion) => assertion.failureMessages ?? []);
    const byAssertion = messages.some((message) => ASSERTION_FAILURE.test(message));
    return {
      outcome: byAssertion ? 'KILLED_ASSERTION' : 'INFRA_FAILURE',
      detail: byAssertion
        ? `the named test ran and rejected the mutation: ${firstLine(messages[0] ?? '')}`
        : `the named test ran but died of something other than an assertion: ${firstLine(messages[0] ?? '')}`,
      matched: named.length,
      unrelatedFailures,
    };
  }

  // The named test did not fail. If it never ran either, the run says nothing about it.
  if (!named.some((assertion) => assertion.status === 'passed')) {
    return {
      outcome: 'INFRA_FAILURE',
      detail: 'the named test neither passed nor failed, so it did not run',
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

/** A baseline is usable only when the named test actually ran and passed on the pristine tree. */
export function baselineIsUsable(classification: Classification): boolean {
  return classification.outcome === 'SURVIVED' && classification.unrelatedFailures === 0;
}
