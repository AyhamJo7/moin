/**
 * In-process assertion provenance for the mutation harness (QG-09, P06.10.07).
 *
 * Loaded as a `setupFiles` entry by every Vitest project, so the sweep measures tests exactly as
 * CI runs them. Two jobs:
 *
 * 1. **Wrap the matcher boundary.** Every function on `Assertion.prototype` is replaced by a
 *    wrapper that, when the matcher throws, appends a `MATCHER_FAILURE` record. That wrapper is
 *    the *only* code that can create one. `throw { name: 'AssertionError', … }` does not call a
 *    matcher, so it creates nothing — which is the whole point, and is why no part of this file
 *    inspects a thrown value.
 *
 * 2. **Bound each invocation.** `beforeEach` opens a window with a fresh id and the canonical
 *    identity taken from Vitest's own task; `afterEach` closes it and emits only the records made
 *    inside it, for that identity. Anything else is counted in `rejected` and the invocation is
 *    marked `suspect`, which every consumer treats as "not evidence".
 *
 * ## Why identity comes from the task and not from `expect.getState()`
 *
 * Measured on Vitest 5.0.2: under `it.concurrent`, the module-level `expect.getState()` reports
 * *another* test's `currentTestName` — two concurrent cases both read the one that started last.
 * Only the test context's own `expect` is correct. `context.task` is always correct, so identity
 * is read from there and never from assertion state.
 *
 * ## Concurrency
 *
 * This file does not try to attribute a matcher failure across overlapping windows. It detects the
 * overlap instead: opening a window while another is open marks both `suspect`, so a concurrent
 * test can never produce evidence rather than producing wrong evidence. The repository uses no
 * `it.concurrent` today; if that changes, the sweep stops trusting those tests and says so.
 */

import { afterEach, beforeEach, expect } from 'vitest';
import {
  MATCHER_FAILURE,
  MATCHER_FAILURE_TOKEN,
  NO_MATCHER_FAILURE,
  PROBE_META_KEY,
  PROBE_VERSION,
  type AssertionProbe,
  type MatcherFailureRecord,
} from './mutation-probe-contract.ts';

/**
 * The async assertion entry points.
 *
 * `not` returns an assertion with the same prototype, so matchers reached through it are already
 * wrapped. `rejects` and `resolves` return a proxy whose matcher calls are awaited, and Vitest
 * raises "promise resolved instead of rejecting" from inside that chain *without* running a
 * matcher — which is still its own assertion machinery failing, not the code under test throwing.
 * Both are instrumented at the getter so that whole chain has provenance. If a Vitest upgrade
 * renames them, `instrumentAsyncEntryPoints` returns a short count and every invocation is marked
 * suspect rather than silently losing evidence.
 */
const ASYNC_ENTRY_POINTS = ['rejects', 'resolves'] as const;

interface Invocation {
  readonly id: string;
  readonly file: string;
  readonly fullName: string;
  /** Records made before this window opened are not ours. */
  readonly firstSeq: number;
  readonly expectCallsAtStart: number;
  readonly suspect: string[];
}

/** Every matcher failure this worker has seen, oldest first. */
const recorded: MatcherFailureRecord[] = [];
/**
 * The error objects already recorded, so one logical failure counts once.
 *
 * A matcher may call another matcher — `toEqual` through `toStrictEqual`, the asymmetric matchers
 * through `toMatchObject` — and the same error then passes through several wrappers on its way
 * out. Keying on the thrown object's identity collapses that exactly, without inspecting it.
 */
const seen = new WeakSet<object>();
let nextSeq = 1;
let nextInvocation = 1;
let open: Invocation | undefined;

function assertionCalls(): number {
  const state = expect.getState() as unknown as Record<string, unknown>;
  const calls = state['assertionCalls'];
  return typeof calls === 'number' ? calls : 0;
}

function record(matcher: string, error: unknown): void {
  // Only once per thrown object, and only for objects: a matcher may call another matcher, and the
  // same error then passes through several wrappers on its way out.
  const token = `${open?.id ?? 'no-invocation'}:${String(nextSeq)}`;
  if (typeof error === 'object' && error !== null) {
    if (seen.has(error)) return;
    seen.add(error);
    try {
      // Enumerable, so Vitest's serializer carries it to the reporter. A frozen or sealed thrown
      // value simply gets no token, and the consumer then fails closed.
      Object.defineProperty(error, MATCHER_FAILURE_TOKEN, {
        value: token,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } catch {
      // Nothing to do: an unstampable error is reported without a token and is not evidence.
    }
  }
  recorded.push({ seq: nextSeq, matcher, token });
  nextSeq += 1;
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
 * `not`, `rejects` and `resolves` are configurable getters that return an assertion with the same
 * prototype, so matchers reached through them are already wrapped and the getters are left alone.
 * Measured: 185 own properties, the matchers among them writable and configurable.
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
      // `rejects`/`resolves` matchers return a promise, and the failure arrives later.
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
    // Bound through a local arrow so the getter is never separated from its receiver.
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
  readonly result?: { readonly errors?: readonly unknown[] };
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
  // Repo-relative, the same spelling the reporter and the manifest use.
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
  if (open !== undefined) {
    // Overlapping windows: either concurrent tests, or an invocation whose afterEach never ran.
    suspect.push(`another invocation (${open.id}) was still open`);
    open.suspect.push('a later invocation opened while this one was still open');
  }
  open = {
    id: `${String(process.pid)}-${String(nextInvocation)}`,
    file: fileOf(task),
    fullName: fullNameOf(task),
    firstSeq: nextSeq,
    expectCallsAtStart: assertionCalls(),
    suspect,
  };
  nextInvocation += 1;
});

afterEach((context) => {
  const invocation = open;
  open = undefined;
  if (invocation === undefined) return;

  const task = context.task as unknown as TaskLike;
  const meta = task.meta;
  if (meta === undefined) return;

  const mine = recorded.filter((entry) => entry.seq >= invocation.firstSeq);
  const rejected = recorded.length - mine.length - (invocation.firstSeq - 1);

  const suspect = [...invocation.suspect];
  // The identity the probe bound at the start must still be the identity closing the window. A
  // mismatch means the hooks were not paired, which is exactly the stale-event case.
  const file = fileOf(task);
  const fullName = fullNameOf(task);
  if (file !== invocation.file || fullName !== invocation.fullName) {
    suspect.push('the invocation closed under a different test identity than it opened under');
  }

  const probe: AssertionProbe = {
    version: PROBE_VERSION,
    event: mine.length > 0 ? MATCHER_FAILURE : NO_MATCHER_FAILURE,
    invocationId: invocation.id,
    testFile: invocation.file,
    testFullName: invocation.fullName,
    matcherFailures: mine.length,
    matchers: mine.map((entry) => entry.matcher),
    failureTokens: mine.map((entry) => entry.token),
    expectCalls: Math.max(assertionCalls() - invocation.expectCallsAtStart, 0),
    rejected: Math.max(rejected, 0),
    suspect,
  };
  meta[PROBE_META_KEY] = probe;
});
