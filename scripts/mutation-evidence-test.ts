/**
 * The trusted evidence wrapper (QG-09, P06.10.07).
 *
 * A test registered with `evidenceTest` may bear mutation evidence; one registered with plain `it`
 * runs exactly as before and simply cannot. The difference is not policy, it is reach: by the time
 * any Vitest hook runs, `task.result.errors[0]` is already a serialized plain object — measured on
 * 5.0.2, `instanceof Error` is false in both `afterEach` and `onTestFailed` — so the only place the
 * terminal value is still the object a matcher threw is inside the test callback.
 *
 * So this wrapper is the interception point:
 *
 *     try { await body(context) }
 *     catch (terminal) { confirmTerminal(terminal); throw terminal }
 *
 * `confirmTerminal` compares `terminal` against a module-private `WeakMap` of objects Vitest
 * matchers threw. The comparison is `===` and nothing else: no name, no message, no fields, and no
 * token. The previous design stamped a token on the error, and
 * `Object.assign(new Error('x'), caught)` copied it onto an unrelated error, which then counted as
 * evidence. Any mark on a value is copyable by whoever can read it; identity is not.
 *
 * The error is rethrown unchanged, so a wrapped test fails, reports and reads exactly as it would
 * have. Nothing about the test's observable behaviour depends on this wrapper.
 */

import { it } from 'vitest';
import { beginEvidence, confirmTerminal } from './mutation-evidence-state.ts';

/** The subset of Vitest's test options the corpus needs. Passed through untouched. */
export interface EvidenceTestOptions {
  readonly retry?: number;
  readonly timeout?: number;
  readonly repeats?: number;
}

type EvidenceBody = (context: never) => unknown;

/** `it` also accepts a bare timeout as its third argument; both forms are normalised here. */
function normalise(options: number | EvidenceTestOptions): EvidenceTestOptions {
  return typeof options === 'number' ? { timeout: options } : options;
}

function intercept(body: EvidenceBody): (context: never) => Promise<void> {
  return async function evidenceBody(context: never): Promise<void> {
    beginEvidence();
    try {
      await body(context);
    } catch (terminal) {
      // Before Vitest serializes it, and before anything else can touch it.
      confirmTerminal(terminal);
      throw terminal;
    }
  };
}

/**
 * Register a test whose failure may count as mutation evidence.
 *
 * Drop-in for `it`, including a bare timeout as the third argument. Options are forwarded in
 * second position, as Vitest 5 requires: the three-argument `test(name, fn, { … })` form was
 * removed in Vitest 4 and throws at collection time.
 */
export function evidenceTest(
  name: string,
  body: EvidenceBody,
  options?: number | EvidenceTestOptions,
): void {
  if (options === undefined) {
    it(name, intercept(body));
    return;
  }
  it(name, normalise(options), intercept(body));
}

/**
 * The concurrent form, so that the refusal to attribute concurrent failures can be demonstrated.
 *
 * With overlapping invocation windows the probe marks both suspect and declines. Nothing in the
 * corpus uses this for evidence.
 */
export function concurrentEvidenceTest(
  name: string,
  body: EvidenceBody,
  options?: number | EvidenceTestOptions,
): void {
  if (options === undefined) {
    it.concurrent(name, intercept(body));
    return;
  }
  it.concurrent(name, normalise(options), intercept(body));
}

export { evidenceTest as mutationEvidenceTest };
