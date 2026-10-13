/**
 * Sliding-window limiter (P08.09.01–.03): budgets enforced, 429 shape,
 * fallback engages when the primary store fails. No I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  MemoryRateStore,
  RATE_BUDGETS,
  checkRate,
  rateLimitProblem,
  type RateStore,
} from './rate-limiter.ts';

describe('rate-limiter', () => {
  it('enforces budgets per scope', async () => {
    const store = new MemoryRateStore();
    const budget = { limit: 2, windowSeconds: 60 };
    expect((await checkRate(store, { scope: 'ip', id: 'a', budget })).allowed).toBe(true);
    expect((await checkRate(store, { scope: 'ip', id: 'a', budget })).allowed).toBe(true);
    const third = await checkRate(store, { scope: 'ip', id: 'a', budget });
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    // Other ids and scopes are unaffected.
    expect((await checkRate(store, { scope: 'ip', id: 'b', budget })).allowed).toBe(true);
    expect((await checkRate(store, { scope: 'user', id: 'a', budget })).allowed).toBe(true);
    expect(RATE_BUDGETS.ip.limit).toBeLessThanOrEqual(RATE_BUDGETS.tenant.limit);
  });

  it('429 carries Retry-After and no budget oracle', async () => {
    const problem = rateLimitProblem(17);
    expect(problem.status).toBe(429);
    expect(problem.headers['retry-after']).toBe('17');
    // No remaining-budget oracle: an attacker must not learn how close the
    // budget is. ("Rate limit" in the detail names the condition, not a count.)
    expect(problem.body.detail).not.toMatch(/\d+ (remaining|left|of \d+)/);
    expect(problem.body).not.toHaveProperty('remaining');
    expect(problem.body).not.toHaveProperty('budget');
  });

  it('fallback engages when the primary store is down', async () => {
    // Primary down: the check fails closed (429 + full window), never open.
    const down: RateStore = {
      hit: () => Promise.reject(new Error('valkey unreachable')),
    };
    const closed = await checkRate(down, { scope: 'tenant', id: 't' });
    expect(closed.allowed).toBe(false);
    expect(closed.retryAfterSeconds).toBe(RATE_BUDGETS.tenant.windowSeconds);
    // Fallback: the memory store enforces the same budgets process-locally.
    const fallback = new MemoryRateStore();
    const budget = { limit: 1, windowSeconds: 60 };
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(true);
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(false);
  });

  it('rejects bad scopes, ids and budgets', async () => {
    const store = new MemoryRateStore();
    await expect(checkRate(store, { scope: 'nope', id: 'a' })).rejects.toBeInstanceOf(RangeError);
    await expect(checkRate(store, { scope: 'ip', id: '' })).rejects.toBeInstanceOf(RangeError);
    await expect(
      checkRate(store, { scope: 'ip', id: 'a', budget: { limit: 0, windowSeconds: 60 } }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
