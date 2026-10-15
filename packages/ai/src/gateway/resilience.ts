/**
 * Gateway resilience (P10.04, FS-02).
 *
 * A decorator around any `ModelGateway`: per-purpose deadlines and retries
 * (PLAN table under "Model gateway (ADR-0012)"), plus a circuit breaker per
 * provider+purpose (5 failures / 30 s → open 60 s, half-open probe).
 *
 * What it is not: retries never repeat `invalid_output` (repeating the same
 * request cannot fix a wrong shape — INV-08), `refused` is a product decision
 * not an error, and budget checks are the caller's (the usage ledger, INV-20,
 * counts attempts; the decorator reports usage, it does not meter it).
 */

import type { GatewayFailureReason, GatewayRequest, GatewayResult, ModelGateway } from './port.ts';

/** Gateway purpose: selects the deadline/retry row from the PLAN table. */
export type GatewayPurpose =
  'voice-nlu' | 'call-summary' | 'email-classification' | 'reply-drafting' | 'import-structuring';

export interface PurposePolicy {
  readonly timeoutMs: number;
  /** Retries after the first attempt. `timeout` and `provider_error` only. */
  readonly maxRetries: number;
}

export const PURPOSE_POLICIES: Readonly<Record<GatewayPurpose, PurposePolicy>> = {
  'voice-nlu': { timeoutMs: 900, maxRetries: 1 },
  'call-summary': { timeoutMs: 20_000, maxRetries: 3 },
  'email-classification': { timeoutMs: 30_000, maxRetries: 3 },
  'reply-drafting': { timeoutMs: 60_000, maxRetries: 2 },
  'import-structuring': { timeoutMs: 60_000, maxRetries: 2 },
};

/** Per-call token cap: the caller refuses to send beyond this (P10.04.03). */
export const MAX_INPUT_TOKENS_PER_CALL = 8_000;

export interface ResilienceOptions {
  readonly purpose: GatewayPurpose;
  /** Breaker scope: provider + purpose (one breaker per pair). */
  readonly scope: string;
  /** Override for tests; defaults to Date.now. */
  readonly now?: () => number;
}

interface BreakerState {
  failures: number[];
  openedAt: number | null;
}

const BREAKERS = new Map<string, BreakerState>();

const FAILURE_WINDOW_MS = 30_000;
const OPEN_MS = 60_000;
const MAX_FAILURES = 5;

/** Test seam: drop all breaker state. */
export function resetBreakers(): void {
  BREAKERS.clear();
}

function stateFor(scope: string): BreakerState {
  let state = BREAKERS.get(scope);
  if (state === undefined) {
    state = { failures: [], openedAt: null };
    BREAKERS.set(scope, state);
  }
  return state;
}

function isRetryable(reason: GatewayFailureReason): boolean {
  return reason === 'timeout' || reason === 'provider_error' || reason === 'rate_limited';
}

/**
 * Wrap a gateway with deadlines, retries and a breaker. The caller's
 * `timeoutMs` is capped by the purpose deadline — a voice turn that takes
 * four seconds has already failed, so the purpose budget wins.
 */
export function withResilience(inner: ModelGateway, options: ResilienceOptions): ModelGateway {
  const now = options.now ?? Date.now;
  const policy = PURPOSE_POLICIES[options.purpose];

  return {
    async complete<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
      const breaker = stateFor(options.scope);
      const at = now();
      if (breaker.openedAt !== null) {
        if (at - breaker.openedAt < OPEN_MS) {
          return {
            ok: false,
            reason: 'provider_error',
            latencyMs: 0,
            detail: `circuit open for ${options.scope}`,
          };
        }
        breaker.openedAt = null;
        breaker.failures = [];
      }

      // ponytail: single attempt cap, not a token estimator — callers that
      // need exact prompt sizing count before calling.
      const deadline = Math.min(request.timeoutMs, policy.timeoutMs);
      const timed: GatewayRequest<T> = { ...request, timeoutMs: deadline };

      let last: GatewayResult<T> | null = null;
      for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
        const result = await inner.complete(timed);
        if (result.ok) {
          breaker.failures = [];
          return result;
        }
        last = result;
        if (!isRetryable(result.reason)) {
          recordFailure(breaker, now());
          return result;
        }
      }
      recordFailure(breaker, now());
      return last ?? { ok: false, reason: 'provider_error', latencyMs: 0 };
    },
  };
}

function recordFailure(breaker: BreakerState, at: number): void {
  breaker.failures = [...breaker.failures, at].filter((t) => at - t < FAILURE_WINDOW_MS);
  if (breaker.failures.length >= MAX_FAILURES) breaker.openedAt = at;
}
