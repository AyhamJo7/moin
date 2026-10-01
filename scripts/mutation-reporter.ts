/**
 * The trusted mutation reporter (P06.10.07, QG-09).
 *
 * ## The trust boundary
 *
 * This runs in the test-runner process and is the **only** thing that decides whether a failure was
 * an assertion. The parent sweep consumes `failureCategory` and never re-derives it, because every
 * attempt to re-derive it from the error has been spoofable:
 *
 *   - exit code alone → an unreachable database counted as a kill;
 *   - message text → `database connection refused while executing toThrow assertion` counted;
 *   - `name` plus `expected`/`actual`/`showDiff`/`ok` → an ordinary `Error` decorated with exactly
 *     those fields counted. Measured, all three.
 *
 * An error object is whatever the test threw, so it cannot be the authority.
 *
 * ## What makes `ASSERTION` trustworthy
 *
 * Two independent signals, both outside the thrown object's control, and **both** required:
 *
 *  1. `expectCalls > 0`, from `scripts/mutation-assertion-probe.ts`, which reads Vitest's own
 *     `assertionCalls` counter in-process. A thrown object cannot increment it. Necessary, not
 *     sufficient — a test can call `expect` successfully and then throw.
 *  2. The error carries **no foreign-object markers**. Vitest's serializer adds `constructor` and
 *     `toString` keys to errors it does not recognise as its own assertion error, and omits them
 *     for ones it does. Measured on this version:
 *
 *       genuine `expect` failure    keys: actual diff expected message name ok operator showDiff stack stacks
 *       decorated plain Error       keys: … plus `constructor`, `toString`
 *       Node's own AssertionError   keys: … plus `constructor`, `toString`
 *       plain thrown Error          keys: constructor message name stack stacks toString
 *
 *     The markers are added by Vitest from the real object, so a test cannot remove them, and
 *     adding them by hand only makes an error look more foreign.
 *
 * Signal 2 is an observed serializer behaviour rather than a documented contract, so it is pinned by
 * `scripts/mutation-reporter.integration.test.ts`, which runs real Vitest over real fixtures —
 * genuine failure, spoofed error, hook failures, timeout, duplicate names. If a Vitest upgrade
 * changes the serializer, that test fails loudly instead of this file silently accepting spoofs.
 *
 * Anything this file cannot classify confidently is `UNKNOWN`, which is not evidence.
 */

import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Reporter } from 'vitest/node';
import { PROBE_META_KEY, PROBE_VERSION, type AssertionProbe } from './mutation-probe-contract.ts';

/** Bumped when the emitted shape changes; the sweep refuses a report it does not understand. */
export const REPORT_VERSION = 2;

const OUTPUT = 'MOIN_MUTATION_REPORT';

/** Keys Vitest's serializer attaches to errors it does not own. */
const FOREIGN_MARKERS = ['constructor', 'toString'] as const;
/** Fields every Vitest matcher sets. Necessary for an assertion, never sufficient on their own. */
const ASSERTION_FIELDS = ['expected', 'actual', 'showDiff', 'ok'] as const;
/** A test that ran out of time rather than asserting. Vitest gives no typed flag for this. */
const TIMEOUT_MESSAGE = /^Test timed out in \d+ms/u;

/** Why a test, hook, module or run failed. Only `ASSERTION` can become evidence. */
export type FailureCategory = 'ASSERTION' | 'ERROR' | 'TIMEOUT' | 'LOAD' | 'UNKNOWN';

export interface ReportedError {
  readonly name: string;
  /** Markers Vitest added because it did not recognise the error as its own. */
  readonly foreignMarkers: readonly string[];
  readonly assertionFields: readonly string[];
  readonly category: FailureCategory;
  /** First line, for the report's detail column. Never used to classify. */
  readonly message: string;
}

export interface ReportedTest {
  /** Repository-relative module path — half of the canonical identity. */
  readonly file: string;
  /** Vitest's full name — the other half. Compared exactly, never as a substring. */
  readonly fullName: string;
  readonly state: string;
  /** True when the test body actually ran. */
  readonly executed: boolean;
  /** The reporter's verdict. Undefined when the test did not fail. */
  readonly failureCategory: FailureCategory | undefined;
  /** What the in-process probe saw, or undefined when it never ran. */
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

function keysOf(value: unknown): readonly string[] {
  // `in` throws on a primitive, which a test is free to throw.
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

/**
 * Classify one error. Deliberately does **not** take `expectCalls`: a module or hook error has no
 * owning test, and an error is only ever promoted to `ASSERTION` by `categoriseTest` below, which
 * has both signals.
 */
function reportError(error: unknown): ReportedError {
  const keys = new Set(keysOf(error));
  const record = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const name = typeof record['name'] === 'string' ? record['name'] : 'unknown';
  const message = firstLine(record['message']);
  const foreignMarkers = FOREIGN_MARKERS.filter((marker) => keys.has(marker));
  const assertionFields = ASSERTION_FIELDS.filter((field) => keys.has(field));

  let category: FailureCategory = 'ERROR';
  if (TIMEOUT_MESSAGE.test(message)) {
    category = 'TIMEOUT';
  } else if (
    /Transform failed|PARSE_ERROR|Failed to load|Cannot find (?:module|package)|Failed to resolve/u.test(
      message,
    )
  ) {
    category = 'LOAD';
  }

  return { name, foreignMarkers, assertionFields, category, message };
}

/**
 * The reporter's verdict for one failed test, using both signals.
 *
 * `ASSERTION` requires: the probe ran; `expect` was actually called; and **every** recorded error
 * is one Vitest owns, with the fields a matcher sets and an `AssertionError` name. One foreign
 * error among them — an `afterEach` that threw — makes the whole run `ERROR`, because a run with a
 * broken teardown is not clean evidence of anything.
 */
function categoriseTest(
  errors: readonly ReportedError[],
  probe: AssertionProbe | undefined,
): FailureCategory {
  if (errors.length === 0) return 'UNKNOWN';
  if (errors.some((error) => error.category === 'TIMEOUT')) return 'TIMEOUT';
  if (errors.some((error) => error.category === 'LOAD')) return 'LOAD';

  // Fail closed on a missing or stale probe: without it there is no in-process signal at all.
  if (probe?.version !== PROBE_VERSION) return 'UNKNOWN';
  if (probe.expectCalls === 0) return 'ERROR';

  const everyErrorIsOurs = errors.every(
    (error) =>
      error.foreignMarkers.length === 0 &&
      error.assertionFields.length === ASSERTION_FIELDS.length &&
      error.name === 'AssertionError',
  );
  return everyErrorIsOurs ? 'ASSERTION' : 'ERROR';
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

function probeOf(task: TaskLike): AssertionProbe | undefined {
  const meta = task.meta?.();
  if (typeof meta !== 'object' || meta === null) return undefined;
  const candidate = (meta as Record<string, unknown>)[PROBE_META_KEY];
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const record = candidate as Record<string, unknown>;
  if (typeof record['version'] !== 'number' || typeof record['expectCalls'] !== 'number') {
    return undefined;
  }
  return {
    version: record['version'],
    expectCalls: record['expectCalls'],
    recordedErrors: typeof record['recordedErrors'] === 'number' ? record['recordedErrors'] : 0,
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
        tests.push({
          file,
          fullName: task.fullName ?? task.name ?? '',
          state,
          // The probe only runs around a test that executed, so its presence is the signal.
          executed: state === 'passed' || state === 'failed',
          failureCategory: state === 'failed' ? categoriseTest(errors, probe) : undefined,
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

/** Exported for the reporter's own tests, which pin the serializer behaviour signal 2 relies on. */
export { categoriseTest, reportError };
