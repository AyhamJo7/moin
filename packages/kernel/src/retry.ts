/**
 * Worker retry policy (P08.05.02, ADR-0008): per-type exponential backoff with
 * jitter, max attempts, DLQ end-state.
 *
 * The queue mechanics (ChangeMessageVisibility, DLQ move) live in the worker
 * runtime (P08.05.01); this module is the pure arithmetic both the runtime
 * and the tests share: same attempt, same ceiling — the jitter is the only
 * randomness, and it is injected so tests pin it.
 *
 * Poison (P08.05.03) is not retried: a schema-invalid payload goes to DLQ
 * immediately with its reason. The classifier is `isPoison`: a RangeError
 * from envelope/payload validation. Anything else is transient.
 */

export interface RetryDecision {
  /** Delay before the next attempt, seconds (visibility extension). */
  readonly delaySeconds: number;
  /** True when attempts are exhausted — the message goes to DLQ. */
  readonly toDlq: boolean;
}

/** Max attempts per job type before DLQ (P08.05.02). */
export const MAX_ATTEMPTS: Readonly<Record<string, number>> = {
  'postcall-finalise': 5,
  'notification-send': 5,
  'sweep-run': 3,
  'retention-purge': 3,
  'import-structure': 3,
  'reverify-sweep': 3,
};

/** Base backoff per attempt (0-indexed): 30s, 2m, 8m, 15m, capped 30m. */
const BASE_S = [30, 120, 480, 900, 1800];

/** Jitter window: ±20 % of the base, uniform. */
const JITTER_FRACTION = 0.2;

/** Schema-invalid payloads are poison (RangeError), never retried (P08.05.03). */
export function isPoison(error: unknown): boolean {
  return error instanceof RangeError;
}

/**
 * Backoff for an attempt: base × (1 ± 20 % jitter). `random` injects the
 * uniform source (Math.random in production, a fixed value in tests).
 */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const base = BASE_S[Math.min(Math.max(attempt, 0), BASE_S.length - 1)] ?? 1800;
  const u = Math.min(Math.max(random(), 0), 1);
  return Math.round(base * (1 - JITTER_FRACTION + 2 * JITTER_FRACTION * u));
}

/** Decide retry vs DLQ for a failed attempt of a job type. */
export function decideRetry(
  type: string,
  attempt: number,
  random: () => number = Math.random,
): RetryDecision {
  const max = MAX_ATTEMPTS[type] ?? 3;
  if (attempt + 1 >= max) return { delaySeconds: 0, toDlq: true };
  return { delaySeconds: backoffSeconds(attempt, random), toDlq: false };
}

const SAFE_FAILURE_CODE = /^[a-z][a-z0-9-]{0,59}$/u;

/**
 * A handler failure with a stable, content-free code (P08.05.02/.03).
 *
 * The code is what the ledger, the DLQ attributes and the logs carry. The message is the code and
 * nothing else, so no handler can leak payload or personal data through an error string (INV-12).
 * `permanent` failures skip the retry schedule and go to the DLQ at once.
 */
export class JobFailure extends Error {
  public override readonly name = 'JobFailure';

  public readonly code: string;
  public readonly permanent: boolean;

  public constructor(code: string, permanent = false) {
    super(code);
    this.code = code;
    this.permanent = permanent;
  }
}

export interface FailureClass {
  readonly code: string;
  readonly permanent: boolean;
}

/**
 * Maps whatever a handler threw to a safe code and a retry class. Unknown errors are transient
 * under the generic `handler-error` code: their message and stack never reach the ledger.
 */
export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof JobFailure && SAFE_FAILURE_CODE.test(error.code)) {
    return { code: error.code, permanent: error.permanent };
  }
  if (isPoison(error)) return { code: 'payload-invalid', permanent: true };
  return { code: 'handler-error', permanent: false };
}
