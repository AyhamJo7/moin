/**
 * In-process assertion evidence (P06.10.07, QG-09).
 *
 * ## Why this file exists
 *
 * Three generations of the mutation harness decided "was this failure an assertion?" from the error
 * object, and all three were spoofable. The last one accepted an ordinary `Error` decorated with
 * `name = 'AssertionError'` plus `expected`/`actual`/`showDiff`/`ok` — measured — which means an
 * infrastructure failure could be dressed up as proof that an invariant was enforced.
 *
 * The error object cannot be the authority, because the error is whatever the test threw. So this
 * runs **inside the test process** and records something the thrown object cannot touch: how many
 * times `expect()` was actually called during the test.
 *
 * Measured, for the four shapes that matter:
 *
 *   genuine `expect(1).toBe(2)`          expectCalls 1, errors 1
 *   decorated plain Error                expectCalls 0, errors 1
 *   plain thrown Error                   expectCalls 0, errors 1
 *   passing expects, then a plain throw  expectCalls 2, errors 1
 *
 * `expectCalls > 0` is therefore **necessary** for an assertion failure and not sufficient — the
 * last row shows why. The reporter combines it with Vitest's own serializer markers, and the
 * real-Vitest integration fixtures are what prove that combination still holds on this version.
 *
 * Loaded as a `setupFiles` entry by the sweep, so a test suite's own hooks cannot displace it:
 * setup-file hooks run outermost.
 */

import { afterEach, beforeEach, expect } from 'vitest';
import { PROBE_META_KEY, PROBE_VERSION, type AssertionProbe } from './mutation-probe-contract.ts';

function assertionCalls(): number {
  const state = expect.getState() as unknown as Record<string, unknown>;
  const calls = state['assertionCalls'];
  return typeof calls === 'number' ? calls : 0;
}

let callsAtStart: number | undefined;

beforeEach(() => {
  callsAtStart = assertionCalls();
});

afterEach((context) => {
  const task = context.task as unknown as {
    meta?: Record<string, unknown>;
    result?: { errors?: unknown[] };
  };
  if (task.meta === undefined) return;

  // No snapshot means the test did not pass through this probe's `beforeEach` — a suite-level
  // failure, for instance. Recording nothing is correct: the reporter fails closed on a missing
  // probe rather than guessing.
  if (callsAtStart === undefined) return;

  const probe: AssertionProbe = {
    version: PROBE_VERSION,
    expectCalls: Math.max(assertionCalls() - callsAtStart, 0),
    recordedErrors: task.result?.errors?.length ?? 0,
  };
  task.meta[PROBE_META_KEY] = probe;
  callsAtStart = undefined;
});
