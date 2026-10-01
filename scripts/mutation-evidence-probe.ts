/**
 * In-process assertion provenance: the matcher boundary (QG-09, P06.10.07).
 *
 * Loaded as a `setupFiles` entry by every Vitest project, so the sweep measures tests exactly as CI
 * runs them. Two jobs, and no decisions — the decisions live in `mutation-evidence-state.ts`.
 *
 * 1. **Wrap the matcher boundary.** Every function on Vitest's `Assertion.prototype` is replaced by
 *    a wrapper that, when the matcher throws, hands the thrown object to the recorder. That wrapper
 *    is the only caller of the recorder, and the recorder is handed out exactly once. `throw` does
 *    not call a matcher, so no throw of any shape can get an object into the map.
 *
 * 2. **Bound each invocation.** `beforeEach` opens a window with a fresh id and the canonical
 *    identity taken from Vitest's own task; `afterEach` closes it and emits the result.
 *
 * ## Why identity comes from the task and not from `expect.getState()`
 *
 * Measured on Vitest 5.0.2: under `it.concurrent`, the module-level `expect.getState()` reports
 * *another* test's `currentTestName` — two concurrent cases both read the one that started last.
 * `context.task` is always correct, so identity is read from there.
 *
 * ## Why a wrapper is needed at all
 *
 * Measured on Vitest 5.0.2: by the time any hook runs, the live thrown object is gone.
 * `task.result.errors[0]` in `afterEach` and in `onTestFailed` is already a serialized plain object
 * — `instanceof Error` is false and the constructor is undefined — so no hook can compare it by
 * identity with what the matcher threw. `task.fn` is not exposed on the task at hook time either,
 * and Vitest 5 exports no base runner class to extend. The only place the terminal value is still
 * the real object is inside the test callback, which is what `mutation-evidence-test.ts` wraps.
 */

import { afterEach, beforeEach, expect } from 'vitest';
import { PROBE_META_KEY, PROBE_VERSION, type AssertionProbe } from '@moin/testing';
import { closeInvocation, installMatcherRecorder, openInvocation } from '@moin/testing';

/**
 * The async assertion entry points.
 *
 * `not` returns an assertion with the same prototype, so matchers reached through it are already
 * wrapped. `rejects` and `resolves` return a proxy whose matcher calls are awaited, and Vitest
 * raises "promise resolved instead of rejecting" from inside that chain *without* running a matcher
 * — which is still its own assertion machinery failing, not the code under test throwing. Both are
 * instrumented at the getter so that whole chain has provenance.
 */
const ASYNC_ENTRY_POINTS = ['rejects', 'resolves'] as const;

const record = installMatcherRecorder();

function assertionCalls(): number {
  const state = expect.getState() as unknown as Record<string, unknown>;
  const calls = state['assertionCalls'];
  return typeof calls === 'number' ? calls : 0;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Replace every matcher on the assertion prototype with a recording wrapper.
 *
 * Measured: 185 own properties, the matchers among them writable and configurable; `not`, `rejects`
 * and `resolves` are configurable getters.
 */
function instrumentMatchers(): number {
  const prototype = Object.getPrototypeOf(expect(undefined)) as Record<string, unknown>;
  let wrapped = 0;

  for (const name of Object.getOwnPropertyNames(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor === undefined) continue;
    if (typeof descriptor.value !== 'function') continue;
    if (descriptor.writable !== true || descriptor.configurable !== true) continue;

    const original = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
    function instrumented(this: unknown, ...args: unknown[]): unknown {
      let result: unknown;
      try {
        result = original.apply(this, args);
      } catch (error) {
        record(name, error);
        throw error;
      }
      if (isThenable(result)) {
        return Promise.resolve(result).catch((error: unknown) => {
          record(name, error);
          throw error;
        });
      }
      return result;
    }
    Object.defineProperty(instrumented, 'name', { value: name, configurable: true });
    Object.defineProperty(prototype, name, { ...descriptor, value: instrumented });
    wrapped += 1;
  }

  return wrapped;
}

/**
 * Wrap the `rejects`/`resolves` getters so the whole awaited chain records.
 *
 * Only these two by name: the other getters on the prototype are chai's flag chain (`to`, `be`,
 * `a`, …) which return `this`, and putting a proxy in front of those would break flag propagation
 * for every test in the repository.
 */
function instrumentAsyncEntryPoints(): number {
  const prototype = Object.getPrototypeOf(expect(undefined)) as Record<string, unknown>;
  let wrapped = 0;

  for (const name of ASYNC_ENTRY_POINTS) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor?.get === undefined || descriptor.configurable !== true) continue;
    const originalGet = (receiver: unknown): unknown => descriptor.get?.call(receiver);

    Object.defineProperty(prototype, name, {
      ...descriptor,
      get(this: unknown): unknown {
        const target: unknown = originalGet(this);
        if (typeof target !== 'object' || target === null) return target;
        return new Proxy(target, {
          get(raw, property, receiver): unknown {
            const value: unknown = Reflect.get(raw, property, receiver);
            if (typeof value !== 'function') return value;
            const matcher = typeof property === 'string' ? property : name;
            return function instrumentedAsync(this: unknown, ...args: unknown[]): unknown {
              let result: unknown;
              try {
                result = (value as (this: unknown, ...a: unknown[]) => unknown).apply(raw, args);
              } catch (error) {
                record(matcher, error);
                throw error;
              }
              if (isThenable(result)) {
                return Promise.resolve(result).catch((error: unknown) => {
                  record(matcher, error);
                  throw error;
                });
              }
              return result;
            };
          },
        });
      },
    });
    wrapped += 1;
  }

  return wrapped;
}

const wrappedMatchers = instrumentMatchers();
const wrappedAsyncEntryPoints = instrumentAsyncEntryPoints();

interface TaskLike {
  readonly name?: string;
  readonly meta?: Record<string, unknown>;
  readonly file?: { readonly filepath?: string; readonly name?: string };
  readonly suite?: TaskLike;
}

/** Vitest's own full name: the suite names and the test name, joined as the reporter joins them. */
function fullNameOf(task: TaskLike): string {
  const parts: string[] = [];
  for (let node: TaskLike | undefined = task; node !== undefined; node = node.suite) {
    if (typeof node.name === 'string' && node.name.length > 0) parts.unshift(node.name);
  }
  return parts.join(' > ');
}

function fileOf(task: TaskLike): string {
  const path = task.file?.filepath ?? task.file?.name ?? '';
  const root = `${process.cwd()}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}

beforeEach((context) => {
  const task = context.task as unknown as TaskLike;
  const suspect: string[] = [];
  if (wrappedMatchers === 0) {
    suspect.push('no matcher could be instrumented, so no failure has provenance');
  }
  if (wrappedAsyncEntryPoints !== ASYNC_ENTRY_POINTS.length) {
    suspect.push(
      `only ${String(wrappedAsyncEntryPoints)} of ${String(ASYNC_ENTRY_POINTS.length)} async assertion entry points could be instrumented`,
    );
  }
  openInvocation({
    file: fileOf(task),
    fullName: fullNameOf(task),
    expectCalls: assertionCalls(),
    suspect,
  });
});

afterEach((context) => {
  const task = context.task as unknown as TaskLike;
  const closed = closeInvocation(fileOf(task), fullNameOf(task));
  if (closed === undefined) return;
  const meta = task.meta;
  if (meta === undefined) return;

  const probe: AssertionProbe = {
    version: PROBE_VERSION,
    event: closed.event,
    reason: closed.reason,
    invocationId: closed.invocationId,
    testFile: closed.file,
    testFullName: closed.fullName,
    evidenceEligible: closed.eligible,
    matcherFailures: closed.matcherFailures,
    matchers: closed.matchers,
    expectCalls: Math.max(assertionCalls() - closed.expectCallsAtStart, 0),
    rejected: closed.rejected,
    suspect: closed.suspect,
  };
  // Written last, and unconditionally: a test may reach `task.meta` and plant a flawless record of
  // its own, and this overwrites it. The probe is the only writer whose record was earned.
  meta[PROBE_META_KEY] = probe;
});
