/**
 * The contract between the in-process evidence probe and the reporter (QG-09, P06.10.07).
 *
 * This module holds **no side effects** on purpose, so the reporter (main process) and the probe
 * (worker) can both import it without the reporter registering hooks or patching a prototype.
 *
 * ## What a confirmed matcher failure is
 *
 * It is a statement about **JavaScript object identity**: the value that terminated the test body
 * is, by `===`, the very object a Vitest matcher threw during this invocation. Nothing about the
 * value's *contents* takes part.
 *
 * Five generations of this decision read the thrown value instead, and every one was spoofed:
 *
 * | Authority | How it fell |
 * | --- | --- |
 * | exit code | an unreachable database reported every variant killed |
 * | message text | `database connection refused while executing toThrow assertion` counted |
 * | `name` + `expected`/`actual`/`showDiff`/`ok` | an `Error` decorated with those four fields counted |
 * | the above, plus the keys Vitest's serializer adds to foreign errors | a plain object literal of that shape has none of those keys, and counted |
 * | an enumerable token the matcher wrapper stamped on the error | `Object.assign(new Error('x'), caught)` copies the token, and counted |
 *
 * The last one is the instructive failure. A token is a **transferable credential**: anything a test
 * can read off one object it can write onto another, and making it a symbol, non-enumerable, random
 * or signed changes nothing about that — it only raises the price of copying it. So there is no
 * token any more, and no field of the thrown value is consulted. Object identity cannot be copied:
 * `Object.assign(terminal, caught)` yields `terminal !== caught`, which is the whole mechanism.
 *
 * `expectCalls`, the error's `name` and its `message` survive in the report as **diagnostics**.
 * Nothing reads them to decide anything.
 */

/** Bumped whenever the probe's emitted shape changes. A reporter rejects any other version. */
export const PROBE_VERSION = 3;

/** Where the probe attaches its record on a Vitest task. */
export const PROBE_META_KEY = 'moinAssertionProbe';

/**
 * The value that terminated the test body was, by object identity, the matcher's own thrown object.
 *
 * The only event that can make a failure assertion evidence.
 */
export const MATCHER_IDENTITY_CONFIRMED = 'MATCHER_IDENTITY_CONFIRMED';

/** Anything else: no matcher threw, the terminal value was a different object, or the state is unsafe. */
export const NON_EVIDENCE = 'NON_EVIDENCE';

export type ProbeEvent = typeof MATCHER_IDENTITY_CONFIRMED | typeof NON_EVIDENCE;

/**
 * What the probe attaches to each test it saw through.
 *
 * Absent means the probe did not complete for that test — a hook failed around it, or the worker
 * died — and every consumer treats absence as "not evidence" rather than as "no failure".
 */
export interface AssertionProbe {
  readonly version: number;
  readonly event: ProbeEvent;
  /** Why the verdict came out as it did. Diagnostic, and the useful column in a report. */
  readonly reason: string;
  /** Unique per invocation, including per retry. Ties the confirmation to one execution. */
  readonly invocationId: string;
  /** Canonical identity, read from Vitest's own task, not from `expect.getState()`. */
  readonly testFile: string;
  readonly testFullName: string;
  /**
   * Whether this test was registered through the trusted evidence wrapper.
   *
   * Only a wrapped test has its terminal value compared at all: by the time any Vitest hook runs,
   * `task.result.errors` holds a serialized copy and the live object is gone (measured on 5.0.2 —
   * `instanceof Error` is already false in `afterEach` and in `onTestFailed`). An unwrapped test
   * runs normally and is simply not eligible for mutation evidence.
   */
  readonly evidenceEligible: boolean;
  /** Distinct matcher failures in this invocation. Exactly one is required for evidence. */
  readonly matcherFailures: number;
  /** Which matchers threw. Diagnostic. */
  readonly matchers: readonly string[];
  /** `expect.getState().assertionCalls` delta. **Diagnostic only** — never provenance. */
  readonly expectCalls: number;
  /** Matcher failures recorded outside this invocation's window, and so discarded. */
  readonly rejected: number;
  /** Non-empty means the probe refuses to vouch for this invocation; consumers fail closed. */
  readonly suspect: readonly string[];
}
