/**
 * A Vitest reporter that emits **typed** failure metadata (P06.10.07, QG-09).
 *
 * ## Why the built-in JSON report is not enough
 *
 * Vitest's JSON reporter renders each failure as `failureMessages: string[]` — human-readable text
 * and nothing else. Classifying a mutation from that means matching words, and matching words is
 * wrong in the direction that matters: an ordinary error reading
 *
 *   Error: database connection refused while executing toThrow assertion
 *
 * contains `toThrow`, so a text-matching classifier called it an assertion failure and counted an
 * unreachable database as proof that an invariant was enforced. Measured on three of four crafted
 * messages.
 *
 * ## What is emitted instead
 *
 * The reporter sees the live error objects, so it records what they *are*:
 *
 *   - `name`, read from the error rather than from its text;
 *   - whether the error carries Chai/Vitest assertion metadata — `expected`, `actual`, `showDiff`,
 *     `ok` — which every matcher sets and no thrown `Error` has. Verified across `toBe`,
 *     `toStrictEqual`, `toMatchObject`, `toContain`, `toBeGreaterThan`, `toThrow`, `not.toBe` and
 *     `rejects.toThrow`: all eight carry those four; `operator` is absent on two of them, so it is
 *     recorded but not required.
 *
 * `message` is carried for the report's detail line only. It never decides a category.
 *
 * Hook and module failures are kept separate from test failures, because a `beforeAll` that threw
 * and an assertion that fired are opposite conclusions about the same exit code.
 */

import { writeFileSync } from 'node:fs';
import type { Reporter } from 'vitest/node';

/** Where to write. The sweep sets this per run. */
const OUTPUT = 'MOIN_MUTATION_REPORT';

/** The four fields every Vitest matcher attaches and no plain `Error` has. */
const ASSERTION_FIELDS = ['expected', 'actual', 'showDiff', 'ok'] as const;

export interface TypedError {
  /** `error.name`, from the object. */
  readonly name: string;
  /** True only when the error carries assertion metadata as own properties. */
  readonly isAssertion: boolean;
  /** Which assertion fields were present, so a reviewer can see the basis of the decision. */
  readonly assertionFields: readonly string[];
  /** First line only, for the report's detail column. Never used to classify. */
  readonly message: string;
}

export interface ReportedTest {
  readonly fullName: string;
  /** `passed`, `failed`, `skipped`, `pending` — Vitest's own test state. */
  readonly state: string;
  readonly errors: readonly TypedError[];
}

export interface ReportedModule {
  readonly moduleId: string;
  readonly state: string;
  /** Module-level failures: transform, resolve, import. */
  readonly errors: readonly TypedError[];
  /** Suite-level failures, which is where a `beforeAll`/`afterAll` throw lands. */
  readonly hookErrors: readonly TypedError[];
  readonly tests: readonly ReportedTest[];
}

export interface MutationReport {
  /** Errors outside any module: global setup, unhandled rejections. */
  readonly unhandledErrors: readonly TypedError[];
  readonly modules: readonly ReportedModule[];
}

function firstLine(value: unknown): string {
  // Only a string is meaningful here; anything else is reported as absent rather than stringified
  // into `[object Object]`.
  return (
    (typeof value === 'string' ? value : '')
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim()
      .slice(0, 200)
      .replace(/\u001B\[[0-9;]*m/gu, '') ?? '' // eslint-disable-line no-control-regex -- removing them
  );
}

/**
 * Reads what the error *is*, never what it says.
 *
 * Exported so the mapping can be tested directly against the shapes measured from real Vitest
 * runs. The reporter's only other job is walking the task tree, which every sweep exercises.
 */
export function typedError(error: unknown): TypedError {
  // A non-object reaches here if a test throws a string or a number, and `in` throws on those.
  // Treated as an untyped failure, which is the fail-closed direction.
  const candidate: Record<string, unknown> =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const present = ASSERTION_FIELDS.filter((field) => field in candidate);
  const name = typeof candidate['name'] === 'string' ? candidate['name'] : 'unknown';
  return {
    name,
    // Both halves are required. The name alone would accept an ordinary error whose `name` was
    // reassigned; the fields alone would accept any object that happens to have them.
    isAssertion: name === 'AssertionError' && present.length === ASSERTION_FIELDS.length,
    assertionFields: present,
    message: firstLine(candidate['message']),
  };
}

function typedAll(errors: unknown): readonly TypedError[] {
  return Array.isArray(errors) ? errors.map(typedError) : [];
}

interface TaskLike {
  readonly fullName?: string;
  readonly name?: string;
  result?: () => { state?: string; errors?: unknown } | undefined;
  errors?: () => unknown;
  state?: () => string;
}

interface ModuleLike {
  readonly moduleId?: string;
  state?: () => string;
  errors?: () => unknown;
  children?: { allTests?: () => Iterable<TaskLike>; allSuites?: () => Iterable<TaskLike> };
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
      const tests: ReportedTest[] = [];
      for (const task of candidate.children?.allTests?.() ?? []) {
        const result = task.result?.();
        tests.push({
          fullName: task.fullName ?? task.name ?? '',
          state: result?.state ?? 'unknown',
          errors: typedAll(result?.errors),
        });
      }

      const hookErrors: TypedError[] = [];
      for (const suite of candidate.children?.allSuites?.() ?? []) {
        hookErrors.push(...typedAll(suite.errors?.()));
      }

      reported.push({
        moduleId: candidate.moduleId ?? '',
        state: candidate.state?.() ?? 'unknown',
        errors: typedAll(candidate.errors?.()),
        hookErrors,
        tests,
      });
    }

    const report: MutationReport = {
      unhandledErrors: typedAll(unhandled),
      modules: reported,
    };
    const destination = process.env[OUTPUT];
    if (destination === undefined || destination.length === 0) {
      throw new Error(`${OUTPUT} is not set, so the mutation report has nowhere to go`);
    }
    writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  }
}
