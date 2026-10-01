/**
 * The trusted evidence wrapper — the public half (QG-09, P06.10.07).
 *
 * A test registered with `evidenceTest` may bear mutation evidence; one registered with plain `it`
 * runs exactly as before and simply cannot. The difference is not policy, it is reach: by the time
 * any Vitest hook runs, `task.result.errors[0]` is already a serialized plain object — measured on
 * 5.0.2, `instanceof Error` is false in both `afterEach` and `onTestFailed` — so the only place the
 * terminal value is still the object a matcher threw is inside the test callback.
 *
 * So the wrapper is the interception point:
 *
 *     beginEvidence()
 *     try { await body(context) }
 *     catch (terminal) { confirmTerminal(terminal); throw terminal }
 *
 * `confirmTerminal` compares `terminal` against a module-private `WeakMap` of objects Vitest
 * matchers threw. The comparison is `===` and nothing else: no name, no message, no fields, and no
 * token. The error is rethrown unchanged, so a wrapped test fails, reports and reads exactly as it
 * would have.
 *
 * This module is what `@moin/testing` exports, and it exports **registration only**. The wrapper,
 * `beginEvidence` and `confirmTerminal` are module-private to `evidence-state.ts` and are not
 * exported from any module, because a test that can call the last two can make itself evidence
 * without being registered for it. `scripts/testing-export-surface.test.ts` holds that line.
 */

export { evidenceTest, concurrentEvidenceTest } from './evidence-state.ts';
export type { EvidenceTestOptions } from './evidence-state.ts';
