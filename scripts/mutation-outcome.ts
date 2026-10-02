/**
 * Deciding what one mutation run established (QG-09 negative controls, P06.10.07).
 *
 * ## What this module may and may not look at
 *
 * It consumes the trusted reporter's `failureCategory` and the canonical test identity, and nothing
 * else. It does **not** inspect error names, messages or fields, because every generation of this
 * decision that did was spoofable — by a plain object literal, by an `Error` whose `toJSON()`
 * returns an assertion shape, and finally by `Object.assign(new Error('x'), caught)`, which copies
 * whatever credential the harness had stamped on a real matcher error. A thrown value is authored
 * by the code under test, and anything readable off it is copyable onto something else.
 *
 * `ASSERTION` rests on **object identity**: the value that terminated the test body is, by `===`,
 * the object a Vitest matcher threw. See `scripts/mutation-evidence-state.ts`.
 *
 * ## The conditions for KILLED_ASSERTION
 *
 *   1. the baseline run passed cleanly (checked by the sweep, not here);
 *   2. the report is one this version understands;
 *   3. nothing failed outside a test — no global or module error;
 *   4. no hook failed around the tests;
 *   5. exactly **one** test matches the manifest's `{ file, fullName }` identity;
 *   6. that test executed;
 *   7. that test failed;
 *   8. the run did not time out, and the test did not fail by timing out;
 *   9. no module failed to build or load;
 *  10. the test is registered through the trusted `evidenceTest` wrapper;
 *  11. the reporter categorised the failure `ASSERTION`, which itself requires:
 *  12.   the value that terminated the test body to be, by `===`, an object a Vitest matcher threw
 *        in this invocation, under this exact identity, with exactly one matcher failure, and with
 *        nothing rejected or suspect in the probe state;
 *  13. **no other test failed** anywhere in the run.
 *
 * Condition 13 matters on its own: a run where the intended test asserted *and* something unrelated
 * blew up is not clean evidence, because the unrelated failure may be the reason the intended one
 * failed. It is reported as `UNRELATED_FAILURE` rather than folded into the kill count.
 *
 * Everything that is not `KILLED_ASSERTION` is reported as itself. Nothing else is evidence.
 */
import { REPORT_VERSION, type MutationReport, type ReportedTest } from './mutation-reporter.ts';

export type {
  FailureCategory,
  MutationReport,
  ReportedError,
  ReportedModule,
  ReportedTest,
} from './mutation-reporter.ts';

/** What a single mutation run establishes. Only `KILLED_ASSERTION` counts as evidence. */
export type MutationOutcome =
  /** The intended test, uniquely identified, failed on a trusted assertion, and nothing else failed. */
  | 'KILLED_ASSERTION'
  /** The intended test ran and passed: the defect is not detected by the test that should catch it. */
  | 'SURVIVED'
  /** The intended test did not pass cleanly on the pristine tree, so the mutant proves nothing. */
  | 'BASELINE_FAILED'
  /** No test in the run has the manifest's exact identity. */
  | 'NO_TEST_MATCH'
  /** More than one test has it, so which one failed cannot be established. */
  | 'AMBIGUOUS_TEST_IDENTITY'
  /** The intended test asserted, but something unrelated also failed. */
  | 'UNRELATED_FAILURE'
  /** A hook — `beforeAll`, `afterEach` — failed. */
  | 'HOOK_FAILURE'
  /** The environment failed: unreachable database, revoked grant, global setup. */
  | 'INFRA_FAILURE'
  /** The whole run exceeded its deadline and was killed. */
  | 'TIMEOUT'
  /** The intended test failed by hanging. A real detection, but not an assertion. */
  | 'KILLED_BY_TIMEOUT'
  /** A module would not transform or load on the pristine tree. */
  | 'BUILD_OR_LOAD_FAILURE'
  /** The mutated source would not transform or load, so the mutation is not testable. */
  | 'INVALID_MUTANT'
  /** No report, a malformed one, or one from a version this classifier does not understand. */
  | 'REPORTER_FAILURE'
  /**
   * The intended test failed, but it is not registered through the trusted evidence wrapper, so
   * its terminal value was never compared and nothing about the failure can be trusted.
   *
   * Not a defect in the code and not a defect in the test — a gap in the manifest's reach.
   */
  | 'NOT_EVIDENCE_ELIGIBLE';

/** The manifest's exact, unambiguous identity for the test that must catch a defect. */
export interface KillingTest {
  /** Repository-relative module path, compared exactly. */
  readonly file: string;
  /** Vitest's full name, compared exactly — never as a substring. */
  readonly fullName: string;
}

export interface RunObservation {
  readonly report: MutationReport | undefined;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  /** Combined stdout and stderr, used only to describe a run that produced no report. */
  readonly output: string;
  /** Which phase this run belongs to: it changes how a load failure is classified. */
  readonly phase: 'baseline' | 'mutant';
}

export interface Classification {
  readonly outcome: MutationOutcome;
  /** One line, safe to print. */
  readonly detail: string;
  /** Tests carrying the manifest's exact identity. Exactly one is required. */
  readonly matched: number;
  /** Failed tests that are not the intended one. Any at all disqualifies a kill. */
  readonly unrelatedFailures: number;
}

/** A report this classifier understands. Anything else is not evidence. */
function isUsableReport(report: MutationReport | undefined): report is MutationReport {
  if (report === undefined) return false;
  return (
    report.reportVersion === REPORT_VERSION &&
    Array.isArray(report.modules) &&
    Array.isArray(report.unhandledErrors)
  );
}

function describe(category: string, message: string): string {
  return `${category}${message.length > 0 ? `: ${message}` : ''}`;
}

/** Exact identity. No `includes`, no prefix, no regex. */
function hasIdentity(test: ReportedTest, identity: KillingTest): boolean {
  return test.file === identity.file && test.fullName === identity.fullName;
}

export function classifyRun(observation: RunObservation, identity: KillingTest): Classification {
  const empty = { matched: 0, unrelatedFailures: 0 } as const;
  const loadOutcome = observation.phase === 'mutant' ? 'INVALID_MUTANT' : 'BUILD_OR_LOAD_FAILURE';

  if (observation.timedOut) {
    return {
      outcome: 'TIMEOUT',
      detail: 'the run exceeded its deadline and was killed, so nothing was established',
      ...empty,
    };
  }

  if (!isUsableReport(observation.report)) {
    // Narrowed by hand: the guard proves it is not a usable report, which TypeScript reduces to
    // `never` for the happy shape, so the version is read off the raw value.
    const raw = observation.report as { reportVersion?: unknown } | undefined;
    const described =
      raw === undefined
        ? `no report was produced (exit ${String(observation.exitCode)})`
        : `the report is malformed, or from report version ${String(raw.reportVersion)} rather than ${String(REPORT_VERSION)}`;
    return { outcome: 'REPORTER_FAILURE', detail: described, ...empty };
  }

  const report = observation.report;

  // Nothing outside a test may have failed. Each of these happens before or around the tests, so
  // whatever the tests did or did not do says nothing about the mutation.
  const unhandled = report.unhandledErrors[0];
  if (unhandled !== undefined) {
    return {
      outcome: unhandled.category === 'LOAD' ? loadOutcome : 'INFRA_FAILURE',
      detail: `the run failed outside any test — ${describe(unhandled.category, unhandled.message)}`,
      ...empty,
    };
  }

  const moduleError = report.modules.flatMap((module) => module.errors)[0];
  if (moduleError !== undefined) {
    return {
      outcome: moduleError.category === 'LOAD' ? loadOutcome : 'INFRA_FAILURE',
      detail: `a module failed to load or run — ${describe(moduleError.category, moduleError.message)}`,
      ...empty,
    };
  }

  const hookError = report.modules.flatMap((module) => module.hookErrors)[0];
  if (hookError !== undefined) {
    return {
      outcome: hookError.category === 'LOAD' ? loadOutcome : 'HOOK_FAILURE',
      detail: `a suite hook failed around its tests — ${describe(hookError.category, hookError.message)}`,
      ...empty,
    };
  }

  const tests = report.modules.flatMap((module) => module.tests);
  const named = tests.filter((test) => hasIdentity(test, identity));
  const unrelatedFailures = tests.filter(
    (test) => test.state === 'failed' && !hasIdentity(test, identity),
  ).length;

  if (named.length === 0) {
    // A run that collected nothing never reached the filter, which is a different failure from a
    // manifest that names a test nobody has.
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
      detail: `no test in ${identity.file} is named exactly "${identity.fullName}"`,
      matched: 0,
      unrelatedFailures,
    };
  }

  if (named.length > 1) {
    return {
      outcome: 'AMBIGUOUS_TEST_IDENTITY',
      detail: `${String(named.length)} tests share the identity ${identity.file} :: "${identity.fullName}", so which one failed cannot be established`,
      matched: named.length,
      unrelatedFailures,
    };
  }

  const test = named[0];
  if (test === undefined) {
    return { outcome: 'REPORTER_FAILURE', detail: 'the matched test is missing', ...empty };
  }

  if (!test.executed) {
    return {
      outcome: 'INFRA_FAILURE',
      detail: `the intended test did not run (state: ${test.state})`,
      matched: 1,
      unrelatedFailures,
    };
  }

  if (test.state !== 'failed') {
    return {
      outcome: 'SURVIVED',
      detail:
        unrelatedFailures > 0
          ? `the intended test passed under the mutation; ${String(unrelatedFailures)} unrelated test(s) failed, which is not evidence either way`
          : 'the intended test passed under the mutation, so it does not detect this defect',
      matched: 1,
      unrelatedFailures,
    };
  }

  if (test.failureCategory === 'TIMEOUT') {
    return {
      outcome: 'KILLED_BY_TIMEOUT',
      detail:
        'the mutation made the code hang, so the intended test timed out rather than asserting',
      matched: 1,
      unrelatedFailures,
    };
  }

  if (test.failureCategory === 'NOT_ELIGIBLE') {
    return {
      outcome: 'NOT_EVIDENCE_ELIGIBLE',
      detail:
        'the intended test detected the mutation, but it is registered with plain `it` rather than ' +
        'the trusted `evidenceTest` wrapper, so its terminal value was never compared by identity',
      matched: 1,
      unrelatedFailures,
    };
  }

  if (test.failureCategory !== 'ASSERTION') {
    return {
      outcome: test.failureCategory === 'LOAD' ? loadOutcome : 'INFRA_FAILURE',
      detail: `the intended test failed, but the reporter categorised it as ${String(test.failureCategory)} rather than a trusted assertion: ${test.probe?.reason ?? 'no probe record'}`,
      matched: 1,
      unrelatedFailures,
    };
  }

  // A trusted assertion, but the run must also be clean. An unrelated failure may be the reason
  // the intended test failed, and a kill that cannot be attributed is not a kill.
  if (unrelatedFailures > 0) {
    return {
      outcome: 'UNRELATED_FAILURE',
      detail: `the intended test asserted, but ${String(unrelatedFailures)} unrelated test(s) also failed, so the kill cannot be attributed`,
      matched: 1,
      unrelatedFailures,
    };
  }

  return {
    outcome: 'KILLED_ASSERTION',
    detail: `the intended test ran and rejected the mutation on a trusted matcher failure (${test.probe?.reason ?? 'confirmed by object identity'})`,
    matched: 1,
    unrelatedFailures: 0,
  };
}

/**
 * A baseline is usable only when the intended test ran, passed, and nothing else failed.
 *
 * Without the last clause a variant could be "killed" by a test that was already red, or in a run
 * whose unrelated failures make every verdict unattributable.
 */
export function baselineIsUsable(classification: Classification): boolean {
  return (
    classification.outcome === 'SURVIVED' &&
    classification.matched === 1 &&
    classification.unrelatedFailures === 0
  );
}
