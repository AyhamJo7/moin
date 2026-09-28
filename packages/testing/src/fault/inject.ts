/**
 * Fault-injection helpers (P02.05.05).
 *
 * Every external integration has to handle timeouts, 429s, 5xx, malformed responses, duplicate and
 * out-of-order events, expired credentials, partial success and unknown state. Those paths are
 * where the expensive bugs live, and they are the paths that never run in a happy-path test — so
 * they need to be triggerable on purpose.
 *
 * The rule these exist to enforce: **a timeout is never success.** An unknown outcome must be
 * reconciled, not assumed (INV-05, INV-11).
 */

export type FaultKind =
  | 'timeout'
  | 'rate-limited'
  | 'server-error'
  | 'malformed-response'
  | 'connection-reset'
  | 'expired-credentials'
  | 'partial-success'
  | 'unknown-outcome';

export class InjectedFault extends Error {
  readonly kind: FaultKind;

  constructor(kind: FaultKind, message?: string) {
    super(message ?? `injected fault: ${kind}`);
    this.name = 'InjectedFault';
    this.kind = kind;
  }
}

export interface FaultPlan {
  /** Fail the first N calls, then succeed — for exercising retry and backoff. */
  readonly failTimes?: number;
  readonly kind: FaultKind;
}

/**
 * Wrap an async function so it fails in a controlled way.
 *
 * `failTimes` models the realistic case rather than the convenient one: a provider that fails
 * twice and then succeeds. A helper that always fails only proves the error branch exists; it
 * never shows whether the retry path actually recovers, or whether recovering a second time
 * duplicates a side effect.
 */
export function withFault<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  plan: FaultPlan,
): ((...args: Args) => Promise<Result>) & { calls: () => number } {
  let calls = 0;
  const wrapped = async (...args: Args): Promise<Result> => {
    calls += 1;
    const shouldFail = plan.failTimes === undefined || calls <= plan.failTimes;
    if (shouldFail) throw new InjectedFault(plan.kind);
    return fn(...args);
  };
  return Object.assign(wrapped, { calls: () => calls });
}

/**
 * A promise that never settles.
 *
 * For asserting that a caller applies its own deadline. Code that awaits a provider without one
 * does not hang loudly — it holds a connection, a queue slot or a call open until something else
 * gives up, which is how one slow dependency becomes an outage.
 */
export function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally empty: settling would defeat the purpose.
  });
}

/** Resolve after `ms`, for testing behaviour that races a deadline. */
export function slow<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(value);
    }, ms),
  );
}
