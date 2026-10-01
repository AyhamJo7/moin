/**
 * The contract between the in-process evidence probe and the reporter (QG-09, P06.10.07).
 *
 * This module holds **no side effects** on purpose. The probe registers Vitest hooks and patches
 * the matcher prototype when it loads, and the reporter runs in the main process where neither
 * belongs; importing the probe from the reporter once crashed the run (`getRunner` asserts that a
 * hook is registered inside a worker). So the shared shape lives here and both sides import it.
 *
 * ## What a trusted assertion event is, and what it is not
 *
 * It is a record created **only** from inside a wrapped Vitest matcher, at the moment that matcher
 * threw. It is not derived from the error it threw. Three generations of this harness tried to
 * recognise an assertion from the thrown value — by message text, then by `name` plus matcher
 * fields, then by the keys Vitest's serializer adds — and every one of them was spoofed, the last
 * two by a plain object literal:
 *
 *     throw { name: 'AssertionError', expected: 1, actual: 2, showDiff: true, ok: false };
 *
 * and by an ordinary `Error` whose `toJSON()` returns that shape. A thrown value is data authored
 * by the code under test. It can never be authority for what the test framework did.
 *
 * So the authority is **provenance**: the only code path that can append a `MATCHER_FAILURE` is a
 * wrapper installed over `Assertion.prototype`, reached by actually invoking a matcher on an
 * assertion Vitest built. Throwing cannot reach it, whatever is thrown.
 *
 * `expectCalls` and the error's `name`/`message` survive in the report as **diagnostics**. Nothing
 * reads them to decide whether a failure was an assertion.
 */

/** Bumped whenever the probe's emitted shape changes. A reporter rejects any other version. */
export const PROBE_VERSION = 2;

/** Where the probe attaches its record on a Vitest task. */
export const PROBE_META_KEY = 'moinAssertionProbe';

/** The only event that can make a failure assertion evidence. */
export const MATCHER_FAILURE = 'MATCHER_FAILURE';

/** A test invocation in which no matcher threw. */
export const NO_MATCHER_FAILURE = 'NONE';

/**
 * The key the wrapper stamps on a thrown value that came out of a matcher.
 *
 * This exists to answer one narrow question: did the matcher failure this invocation earned
 * actually *propagate*, or did the test catch it and fail some other way? It can therefore only
 * ever **remove** evidence. It cannot create any: without a `MATCHER_FAILURE` event no token is
 * looked at, and the event can only come from the wrapper.
 */
export const MATCHER_FAILURE_TOKEN = 'moinMatcherFailureToken';

/** One matcher failure, as the wrapper recorded it. */
export interface MatcherFailureRecord {
  /** Monotonic within the worker, so an event cannot be replayed into a later invocation. */
  readonly seq: number;
  /** Which matcher threw. Diagnostic only — never an input to any verdict. */
  readonly matcher: string;
  /** The value stamped on the thrown object, when it could be stamped at all. */
  readonly token: string;
}

/**
 * What the probe attaches to each test it saw through.
 *
 * Absent means the probe did not complete for that test — a hook failed around it, or the worker
 * died — and every consumer treats absence as "not evidence" rather than as "no failure".
 */
export interface AssertionProbe {
  readonly version: number;
  /** `MATCHER_FAILURE` only when at least one matcher threw inside this invocation. */
  readonly event: typeof MATCHER_FAILURE | typeof NO_MATCHER_FAILURE;
  /** Unique per invocation, including per retry. Ties the event to one execution. */
  readonly invocationId: string;
  /** Canonical identity, read from Vitest's own task, not from `expect.getState()`. */
  readonly testFile: string;
  readonly testFullName: string;
  /** Distinct matcher failures in this invocation. Exactly one is required for evidence. */
  readonly matcherFailures: number;
  /** Which matchers threw. Diagnostic. */
  readonly matchers: readonly string[];
  /**
   * The tokens stamped on the values those matchers threw.
   *
   * A consumer requires the failing test to carry one of these, which is how a matcher failure the
   * test swallowed before failing some other way is kept out of the evidence count.
   */
  readonly failureTokens: readonly string[];
  /** `expect.getState().assertionCalls` delta. **Diagnostic only** — never provenance. */
  readonly expectCalls: number;
  /** Failures recorded outside this invocation's window, and so discarded. */
  readonly rejected: number;
  /** Non-empty means the probe refuses to vouch for this invocation; consumers fail closed. */
  readonly suspect: readonly string[];
}
