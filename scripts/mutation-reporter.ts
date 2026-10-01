/**
 * The trusted mutation reporter (P06.10.07, QG-09).
 *
 * ## The trust boundary
 *
 * This runs in the test-runner process and is the **only** thing that decides whether a failure was
 * an assertion. The parent sweep consumes `failureCategory` and never re-derives it.
 *
 * ## Why nothing here reads the thrown value
 *
 * Four generations of this decision tried to recognise an assertion *from the error*, and every one
 * was spoofed. Measured, in order:
 *
 *   - exit code alone → an unreachable database counted as a kill;
 *   - message text → `database connection refused while executing toThrow assertion` counted;
 *   - `name` plus `expected`/`actual`/`showDiff`/`ok` → an ordinary `Error` decorated with those
 *     four fields counted;
 *   - the above plus "Vitest's serializer adds `constructor`/`toString` to foreign errors" → a
 *     **plain object literal** `{ name: 'AssertionError', expected, actual, showDiff, ok }` is
 *     serialized with none of those markers and counted, and so did an ordinary `Error` whose
 *     `toJSON()` returns that shape.
 *
 * The pattern is not that each heuristic was too loose. It is that the thrown value is **data
 * authored by the code under test**, so no property of it can ever be authority for what the test
 * framework did. There is no tighter list of fields that fixes this.
 *
 * ## What makes `ASSERTION` trustworthy now
 *
 * Provenance, not shape. `scripts/mutation-evidence-probe.ts` wraps every matcher on Vitest's
 * `Assertion.prototype`; a `MATCHER_FAILURE` record can only be created from inside that wrapper,
 * reached by actually invoking a matcher. `throw` does not call a matcher, so no throw of any shape
 * can create one. This reporter requires, for `ASSERTION`:
 *
 *   - a probe of the exact contract version, with no `suspect` entry;
 *   - `event === 'MATCHER_FAILURE'`;
 *   - **exactly one** distinct matcher failure in the invocation — zero is not an assertion, and
 *     more than one means the test swallowed the first, so which failure propagated is unknown;
 *   - the probe's own `testFile`/`testFullName` equal to the identity this reporter recorded, so a
 *     record from another test or another invocation cannot be read as this one's.
 *
 * `expectCalls`, `name` and `message` are carried into the report as **diagnostics**. Nothing reads
 * them to classify. In particular `expectCalls > 0` is explicitly *not* sufficient: a test may call
 * a matcher successfully and then throw anything at all, which is mandatory fixture case 4.
 *
 * Message text is read for exactly two things, and both can only move a verdict *away* from
 * evidence: recognising a timeout, and recognising a transform or module-resolution failure.
 *
 * Anything this file cannot classify confidently is `UNKNOWN`, which is not evidence.
 */

import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Reporter } from 'vitest/node';
import {
  MATCHER_FAILURE,
  MATCHER_FAILURE_TOKEN,
  PROBE_META_KEY,
  PROBE_VERSION,
  type AssertionProbe,
} from './mutation-probe-contract.ts';

/** Bumped when the emitted shape changes; the sweep refuses a report it does not understand. */
export const REPORT_VERSION = 3;

const OUTPUT = 'MOIN_MUTATION_REPORT';

/** A test that ran out of time rather than asserting. Vitest gives no typed flag for this. */
const TIMEOUT_MESSAGE = /^Test timed out in \d+ms/u;
const LOAD_MESSAGE =
  /Transform failed|PARSE_ERROR|Failed to load|Cannot find (?:module|package)|Failed to resolve/u;

/** Why a test, hook, module or run failed. Only `ASSERTION` can become evidence. */
export type FailureCategory = 'ASSERTION' | 'ERROR' | 'TIMEOUT' | 'LOAD' | 'UNKNOWN';

/**
 * A failure as recorded for the report.
 *
 * `name` and `message` are **diagnostics**: they exist so a reviewer reading the report can see
 * what went wrong. No field of this type can promote a failure to `ASSERTION`.
 */
export interface ReportedError {
  readonly name: string;
  readonly category: FailureCategory;
  /** First line only, escape sequences stripped. */
  readonly message: string;
  /**
   * The provenance token the matcher wrapper stamped on this value, when it carries one.
   *
   * Used for one check and one direction only: a matcher failure the test swallowed before failing
   * some other way has an event but no propagated token, and is refused. A token can never promote
   * a failure — without the event nothing reads it.
   */
  readonly matcherToken: string | undefined;
}

/** The canonical identity of one test, as the manifest names it. */
export interface TestIdentity {
  /** Repository-relative module path — half of the identity. */
  readonly file: string;
  /** Vitest's full name — the other half. Compared exactly, never as a substring. */
  readonly fullName: string;
}

export interface ReportedTest extends TestIdentity {
  readonly state: string;
  /** True when the test body actually ran. */
  readonly executed: boolean;
  /** The reporter's verdict. Undefined when the test did not fail. */
  readonly failureCategory: FailureCategory | undefined;
  /** What the in-process probe recorded, or undefined when it never completed. */
  readonly probe: AssertionProbe | undefined;
  readonly errors: readonly ReportedError[];
}

export interface ReportedModule {
  readonly file: string;
  readonly state: string;
  /** Module-level failures: transform, resolve, import. */
  readonly errors: readonly ReportedError[];
  /** Suite-level failures, which is where a `beforeAll`/`afterAll` throw lands. */
  readonly hookErrors: readonly ReportedError[];
  readonly tests: readonly ReportedTest[];
}

export interface MutationReport {
  readonly reportVersion: number;
  readonly probeVersion: number;
  /** Errors outside any module: global setup, unhandled rejections. */
  readonly unhandledErrors: readonly ReportedError[];
  readonly modules: readonly ReportedModule[];
}

function firstLine(value: unknown): string {
  return (
    (typeof value === 'string' ? value : '')
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim()
      // eslint-disable-next-line no-control-regex -- removing the escape sequences Vitest embeds.
      .replace(/\u001B\[[0-9;]*m/gu, '')
      .slice(0, 200) ?? ''
  );
}

/**
 * Record one error for the report.
 *
 * Only `TIMEOUT` and `LOAD` are decided here, both from the message, and both only ever move a
 * verdict away from evidence. Everything else is `ERROR`: this function has no way to say
 * `ASSERTION` and is not given one.
 */
function reportError(error: unknown): ReportedError {
  const record = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const name = typeof record['name'] === 'string' ? record['name'] : 'unknown';
  const message = firstLine(record['message']);
  const stamped = record[MATCHER_FAILURE_TOKEN];
  const matcherToken = typeof stamped === 'string' ? stamped : undefined;

  let category: FailureCategory = 'ERROR';
  if (TIMEOUT_MESSAGE.test(message)) {
    category = 'TIMEOUT';
  } else if (LOAD_MESSAGE.test(message)) {
    category = 'LOAD';
  }

  return { name, category, message, matcherToken };
}

/**
 * The reporter's verdict for one failed test, from provenance alone.
 *
 * `identity` is the identity this reporter resolved from Vitest's module and task. The probe
 * recorded its own copy at the matcher boundary; they must agree, or the record is not this test's.
 */
function categoriseTest(
  errors: readonly ReportedError[],
  probe: AssertionProbe | undefined,
  identity: TestIdentity,
): FailureCategory {
  if (errors.length === 0) return 'UNKNOWN';
  // A run that timed out or failed to load is classified from that, before anything else: both are
  // non-evidence outcomes, and a matcher failure recorded alongside them changes nothing.
  if (errors.some((error) => error.category === 'TIMEOUT')) return 'TIMEOUT';
  if (errors.some((error) => error.category === 'LOAD')) return 'LOAD';

  // Fail closed on a missing, stale or self-doubting probe: without it there is no provenance.
  if (probe === undefined) return 'UNKNOWN';
  if (probe.version !== PROBE_VERSION) return 'UNKNOWN';
  if (probe.suspect.length > 0) return 'UNKNOWN';
  if (probe.rejected > 0) return 'UNKNOWN';

  // The record must belong to this exact test. Exact equality on both halves.
  if (probe.testFile !== identity.file || probe.testFullName !== identity.fullName) {
    return 'UNKNOWN';
  }

  if (probe.event !== MATCHER_FAILURE) return 'ERROR';
  // Zero is not a matcher failure; more than one means the test continued after the first, so which
  // assertion made it fail cannot be established.
  if (probe.matcherFailures !== 1) return 'UNKNOWN';

  // The earned failure must be the one that propagated. Measured: a test that catches
  // `expect(1).toBe(2)` and then throws an ordinary error has the event but not the token, and
  // "the mutation was rejected by an assertion" would be false of it.
  const propagated = errors.some(
    (error) => error.matcherToken !== undefined && probe.failureTokens.includes(error.matcherToken),
  );
  if (!propagated) return 'ERROR';

  return 'ASSERTION';
}

function reportErrors(errors: unknown): readonly ReportedError[] {
  return Array.isArray(errors) ? errors.map(reportError) : [];
}

interface TaskLike {
  readonly fullName?: string;
  readonly name?: string;
  result?: () => { state?: string; errors?: unknown } | undefined;
  meta?: () => unknown;
  errors?: () => unknown;
}

interface ModuleLike {
  readonly moduleId?: string;
  state?: () => string;
  errors?: () => unknown;
  children?: { allTests?: () => Iterable<TaskLike>; allSuites?: () => Iterable<TaskLike> };
}

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Read the probe's record off a task.
 *
 * Every field is checked: a record missing any of them is treated as absent rather than
 * half-trusted, which is what makes a truncated or stale probe fail closed.
 */
function probeOf(task: TaskLike): AssertionProbe | undefined {
  const meta = task.meta?.();
  if (typeof meta !== 'object' || meta === null) return undefined;
  const candidate = (meta as Record<string, unknown>)[PROBE_META_KEY];
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const record = candidate as Record<string, unknown>;
  if (
    typeof record['version'] !== 'number' ||
    typeof record['event'] !== 'string' ||
    typeof record['invocationId'] !== 'string' ||
    typeof record['testFile'] !== 'string' ||
    typeof record['testFullName'] !== 'string' ||
    typeof record['matcherFailures'] !== 'number' ||
    typeof record['expectCalls'] !== 'number' ||
    typeof record['rejected'] !== 'number' ||
    !Array.isArray(record['failureTokens']) ||
    !Array.isArray(record['suspect'])
  ) {
    return undefined;
  }
  return {
    version: record['version'],
    event: record['event'] === MATCHER_FAILURE ? MATCHER_FAILURE : 'NONE',
    invocationId: record['invocationId'],
    testFile: record['testFile'],
    testFullName: record['testFullName'],
    matcherFailures: record['matcherFailures'],
    matchers: stringsOf(record['matchers']),
    failureTokens: stringsOf(record['failureTokens']),
    expectCalls: record['expectCalls'],
    rejected: record['rejected'],
    suspect: stringsOf(record['suspect']),
  };
}

/**
 * Vitest resolves `--reporter=<path>` to a module's **default** export, so this is the one place a
 * default export is correct despite the repository's named-exports rule: the framework chooses the
 * name, not the importer.
 */
// eslint-disable-next-line no-restricted-syntax -- Vitest's reporter contract requires a default export.
export default class MutationReporter implements Reporter {
  onTestRunEnd(modules: unknown, unhandled: unknown): void {
    const reported: ReportedModule[] = [];

    for (const candidate of (modules ?? []) as Iterable<ModuleLike>) {
      const file = relative(process.cwd(), candidate.moduleId ?? '');
      const tests: ReportedTest[] = [];

      for (const task of candidate.children?.allTests?.() ?? []) {
        const result = task.result?.();
        const state = result?.state ?? 'unknown';
        const errors = reportErrors(result?.errors);
        const probe = probeOf(task);
        const identity: TestIdentity = { file, fullName: task.fullName ?? task.name ?? '' };
        tests.push({
          ...identity,
          state,
          executed: state === 'passed' || state === 'failed',
          failureCategory: state === 'failed' ? categoriseTest(errors, probe, identity) : undefined,
          probe,
          errors,
        });
      }

      const hookErrors: ReportedError[] = [];
      for (const suite of candidate.children?.allSuites?.() ?? []) {
        hookErrors.push(...reportErrors(suite.errors?.()));
      }

      reported.push({
        file,
        state: candidate.state?.() ?? 'unknown',
        errors: reportErrors(candidate.errors?.()),
        hookErrors,
        tests,
      });
    }

    const report: MutationReport = {
      reportVersion: REPORT_VERSION,
      probeVersion: PROBE_VERSION,
      unhandledErrors: reportErrors(unhandled),
      modules: reported,
    };

    const destination = process.env[OUTPUT];
    if (destination === undefined || destination.length === 0) {
      throw new Error(`${OUTPUT} is not set, so the mutation report has nowhere to go`);
    }
    writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  }
}

/** Exported for the reporter's own tests, which pin the provenance rule. */
export { categoriseTest, reportError };
