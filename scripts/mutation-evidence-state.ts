/**
 * The private state behind assertion provenance (QG-09, P06.10.07).
 *
 * Side-effect free, so the trusted wrapper can import it from a test file without pulling in the
 * probe's hook registrations or its prototype patch.
 *
 * ## The one fact this module keeps
 *
 * `matcherFailures` maps **an object a Vitest matcher threw** to the invocation it was thrown in.
 * It is a `WeakMap`, it is module-private, and it is never exported — not the map, not a reader for
 * it, not an iterator over it. The only way to learn whether a value is in it is to hand that exact
 * value to `confirmTerminal`, which answers about `===` and nothing else.
 *
 * There is deliberately **no credential** on the thrown object. The previous design stamped an
 * enumerable token on it, and `Object.assign(new Error('x'), caught)` copied that token onto an
 * unrelated error, which then counted as evidence. Any mark on the value — enumerable or not,
 * symbol or string, random or signed — is copyable by the code that can see it. Object identity is
 * the one property of a value that cannot be transferred.
 *
 * ## Who may write
 *
 * `installMatcherRecorder` hands out the record function **once**. The probe takes it when it loads;
 * a second caller gets an exception. So a test cannot obtain a recorder and register an arbitrary
 * object as a matcher failure. This is a guard against accident and against the easy attack; the
 * load-bearing property remains that confirmation needs the actual object a matcher threw.
 */

import {
  MATCHER_IDENTITY_CONFIRMED,
  NON_EVIDENCE,
  type ProbeEvent,
} from './mutation-probe-contract.ts';

interface MatcherFailure {
  readonly invocationId: string;
  readonly file: string;
  readonly fullName: string;
  readonly matcher: string;
  readonly seq: number;
}

interface Invocation {
  readonly id: string;
  readonly file: string;
  readonly fullName: string;
  /** Matcher failures recorded before this window opened are not ours. */
  readonly firstSeq: number;
  readonly expectCallsAtStart: number;
  readonly suspect: string[];
  /** Set by the trusted wrapper when the test body starts. */
  eligible: boolean;
  /** Set by `confirmTerminal`. Undefined means the wrapper never reported a terminal value. */
  confirmation?: { readonly event: ProbeEvent; readonly reason: string };
}

/** Private: the only record of which objects came out of a matcher. Never exported. */
const matcherFailures = new WeakMap<object, MatcherFailure>();
/** Private: every matcher failure this worker has seen, oldest first. */
const recorded: MatcherFailure[] = [];

let nextSeq = 1;
let nextInvocation = 1;
let open: Invocation | undefined;
let recorderInstalled = false;

export interface OpenOptions {
  readonly file: string;
  readonly fullName: string;
  readonly expectCalls: number;
  /** Reasons the caller already knows this invocation cannot be vouched for. */
  readonly suspect: readonly string[];
}

export interface ClosedInvocation {
  readonly event: ProbeEvent;
  readonly reason: string;
  readonly invocationId: string;
  readonly file: string;
  readonly fullName: string;
  readonly eligible: boolean;
  readonly matcherFailures: number;
  readonly matchers: readonly string[];
  readonly expectCallsAtStart: number;
  readonly rejected: number;
  readonly suspect: readonly string[];
}

/** Hand out the record function. Callable once; the probe is the caller. */
export function installMatcherRecorder(): (matcher: string, error: unknown) => void {
  if (recorderInstalled) {
    throw new Error('the matcher recorder is already installed; there is exactly one writer');
  }
  recorderInstalled = true;
  return record;
}

function record(matcher: string, error: unknown): void {
  // Objects only. A matcher that throws a primitive (none do, but nothing forbids it) cannot be
  // identified later, so it is counted and deliberately left unconfirmable.
  if (typeof error !== 'object' || error === null) {
    recorded.push({
      invocationId: open?.id ?? 'none',
      file: '',
      fullName: '',
      matcher,
      seq: nextSeq,
    });
    nextSeq += 1;
    return;
  }
  // Once per thrown object: a matcher may call another matcher, and the same error then passes
  // through several wrappers on its way out. Keying on identity collapses that exactly.
  if (matcherFailures.has(error)) return;
  const entry: MatcherFailure = {
    invocationId: open?.id ?? 'none',
    file: open?.file ?? '',
    fullName: open?.fullName ?? '',
    matcher,
    seq: nextSeq,
  };
  nextSeq += 1;
  matcherFailures.set(error, entry);
  recorded.push(entry);
}

/** Open an invocation window. Returns the reasons it is already suspect. */
export function openInvocation(options: OpenOptions): readonly string[] {
  const suspect = [...options.suspect];
  if (open !== undefined) {
    // Overlapping windows: either concurrent tests, or an invocation whose close never ran.
    suspect.push(`another invocation (${open.id}) was still open`);
    open.suspect.push('a later invocation opened while this one was still open');
  }
  open = {
    id: `${String(process.pid)}-${String(nextInvocation)}`,
    file: options.file,
    fullName: options.fullName,
    firstSeq: nextSeq,
    expectCallsAtStart: options.expectCalls,
    suspect,
    eligible: false,
  };
  nextInvocation += 1;
  return suspect;
}

/** The trusted wrapper declares that this invocation may bear evidence. */
export function beginEvidence(): void {
  if (open === undefined) return;
  open.eligible = true;
}

/**
 * The terminal value of the test body, handed over by the trusted wrapper before Vitest sees it.
 *
 * Everything here is `===` against the private map. No field of `terminal` is read.
 */
export function confirmTerminal(terminal: unknown): void {
  const invocation = open;
  if (invocation === undefined) return;
  const mine = recorded.filter((entry) => entry.seq >= invocation.firstSeq);

  const verdict = ((): { event: ProbeEvent; reason: string } => {
    if (!invocation.eligible) {
      return { event: NON_EVIDENCE, reason: 'the test is not registered for evidence' };
    }
    if (typeof terminal !== 'object' || terminal === null) {
      return {
        event: NON_EVIDENCE,
        reason: 'the terminal value is not an object, so no matcher threw it',
      };
    }
    const entry = matcherFailures.get(terminal);
    if (entry === undefined) {
      return {
        event: NON_EVIDENCE,
        reason:
          'the terminal value is not an object a matcher threw; a copy is not the same object',
      };
    }
    if (entry.invocationId !== invocation.id) {
      return {
        event: NON_EVIDENCE,
        reason: `the matcher failure belongs to invocation ${entry.invocationId}, not ${invocation.id}`,
      };
    }
    if (entry.file !== invocation.file || entry.fullName !== invocation.fullName) {
      return {
        event: NON_EVIDENCE,
        reason: 'the matcher failure was recorded under another test identity',
      };
    }
    if (mine.length !== 1) {
      return {
        event: NON_EVIDENCE,
        reason: `${String(mine.length)} matcher failures in one invocation, so which one is the assertion cannot be established`,
      };
    }
    return {
      event: MATCHER_IDENTITY_CONFIRMED,
      reason: `the terminal value is the object ${entry.matcher} threw`,
    };
  })();

  invocation.confirmation = verdict;
}

/** Close the window and report it. The caller re-reads identity so a mismatch can be detected. */
export function closeInvocation(file: string, fullName: string): ClosedInvocation | undefined {
  const invocation = open;
  open = undefined;
  if (invocation === undefined) return undefined;

  const mine = recorded.filter((entry) => entry.seq >= invocation.firstSeq);
  const rejected = Math.max(recorded.length - mine.length - (invocation.firstSeq - 1), 0);
  const suspect = [...invocation.suspect];
  if (file !== invocation.file || fullName !== invocation.fullName) {
    suspect.push('the invocation closed under a different test identity than it opened under');
  }

  const confirmation = invocation.confirmation ?? {
    event: NON_EVIDENCE,
    reason: invocation.eligible
      ? 'the test body did not throw, or the wrapper never reported a terminal value'
      : 'the test is not registered for evidence',
  };

  return {
    event: confirmation.event,
    reason: confirmation.reason,
    invocationId: invocation.id,
    file: invocation.file,
    fullName: invocation.fullName,
    eligible: invocation.eligible,
    matcherFailures: mine.length,
    matchers: mine.map((entry) => entry.matcher),
    expectCallsAtStart: invocation.expectCallsAtStart,
    rejected,
    suspect,
  };
}

/** Diagnostics for the probe's own tests: how many windows this worker has opened. */
export function invocationsOpened(): number {
  return nextInvocation - 1;
}
