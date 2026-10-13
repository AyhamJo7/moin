/**
 * Sliding-window rate limiter (P08.09.01–.02, ADR-0009): per-scope budgets
 * with a Valkey primary and an in-memory fallback.
 *
 * Scopes (P08.09.01): ip, session, user, tenant, endpoint-class — each with
 * its own (limit, window). The store is injected: Valkey in workers (atomic
 * INCR + EXPIRE per window bucket), the memory fallback here when Valkey is
 * down (P08.09.01) — a fallback that fails open would turn an outage into
 * abuse, so it enforces the same budgets process-locally instead.
 *
 * Refusals (P08.09.02) are standard 429 problem responses with `Retry-After`
 * (seconds until the window rolls). The body is coarse — never the remaining
 * budget (INV-12: a remaining-budget oracle lets an attacker pace the attack).
 */

export type RateScope = 'ip' | 'session' | 'user' | 'tenant' | 'endpoint';

export interface RateBudget {
  /** Max hits per window. */
  readonly limit: number;
  /** Window length, seconds. */
  readonly windowSeconds: number;
}

export interface RateVerdict {
  readonly allowed: boolean;
  /** Seconds until retry (0 when allowed). */
  readonly retryAfterSeconds: number;
}

/** Default budgets per scope (P08.09.01): tight on ip, loose on tenant. */
export const RATE_BUDGETS: Readonly<Record<RateScope, RateBudget>> = {
  ip: { limit: 60, windowSeconds: 60 },
  session: { limit: 120, windowSeconds: 60 },
  user: { limit: 300, windowSeconds: 60 },
  tenant: { limit: 1000, windowSeconds: 60 },
  endpoint: { limit: 30, windowSeconds: 60 },
};

/** Counter seam: Valkey implements it in workers; memory here for fallback/tests. */
export interface RateStore {
  /** Atomically increment the window bucket; returns the new count + TTL. */
  hit: (key: string, windowSeconds: number) => Promise<{ count: number; ttlSeconds: number }>;
}

/** In-memory fallback (P08.09.01): same budgets, process-local buckets. */
export class MemoryRateStore implements RateStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  public constructor(private readonly now: () => number = Date.now) {}

  public async hit(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const at = this.now();
    const found = this.buckets.get(key);
    if (found === undefined || at >= found.resetAt) {
      const resetAt = at + windowSeconds * 1000;
      this.buckets.set(key, { count: 1, resetAt });
      return { count: 1, ttlSeconds: windowSeconds };
    }
    found.count += 1;
    return { count: found.count, ttlSeconds: Math.max(1, Math.ceil((found.resetAt - at) / 1000)) };
  }
}

function checkScope(scope: string): RateScope {
  if (
    scope !== 'ip' &&
    scope !== 'session' &&
    scope !== 'user' &&
    scope !== 'tenant' &&
    scope !== 'endpoint'
  ) {
    throw new RangeError('rate scope must be ip, session, user, tenant or endpoint');
  }
  return scope;
}

/**
 * Check one scope against its budget: allowed, or 429 with Retry-After.
 * Store errors fail CLOSED (allowed=false, full window retry) — a limiter
 * that fails open turns a Valkey outage into unlimited abuse.
 */
export async function checkRate(
  store: RateStore,
  input: { scope: string; id: string; budget?: RateBudget | undefined },
): Promise<RateVerdict> {
  const scope = checkScope(input.scope);
  const id = input.id.trim();
  if (id.length === 0 || id.length > 200) throw new RangeError('rate id must be 1..200 characters');
  const budget = input.budget ?? RATE_BUDGETS[scope];
  if (!Number.isInteger(budget.limit) || budget.limit <= 0) {
    throw new RangeError('rate limit must be an integer ≥ 1');
  }
  if (!Number.isInteger(budget.windowSeconds) || budget.windowSeconds <= 0) {
    throw new RangeError('rate window must be an integer ≥ 1 second');
  }
  const key = `ratelimit:${scope}:${id}`;
  try {
    const { count, ttlSeconds } = await store.hit(key, budget.windowSeconds);
    if (count <= budget.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: ttlSeconds };
  } catch {
    return { allowed: false, retryAfterSeconds: budget.windowSeconds };
  }
}

/** Standard 429 problem body (P08.09.02): coarse, no remaining budget. */
export function rateLimitProblem(retryAfterSeconds: number): {
  status: number;
  headers: Record<string, string>;
  body: { type: string; title: string; status: number; detail: string };
} {
  return {
    status: 429,
    headers: { 'retry-after': String(Math.max(1, retryAfterSeconds)) },
    body: {
      type: 'https://moin.local/problems/rate-limited',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Retry after the indicated delay.',
    },
  };
}
