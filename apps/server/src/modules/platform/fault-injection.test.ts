/**
 * Async failure injection (P08.11.01–.02), the part that is not the job consumer: with Valkey
 * down, the rate limiter fails closed (P08.09.01). An SSE client switching to polling is not
 * tested here; it stays open (A2).
 *
 * The worker-side faults run against the real consumer, database and queue in
 * `job-consumer.integration.test.ts`. The report, with what each test proves and what stays open,
 * is docs/verification/failure-injection-report.md (P08.11.03).
 */
import { describe, expect, it } from 'vitest';
import { MemoryRateStore, checkRate, type RateStore } from './rate-limiter.ts';

describe('fault-injection', () => {
  it('Valkey outage: the limiter fails closed', async () => {
    // A failing store refuses rather than opening (P08.09.01); the in-memory store enforces the
    // same budget.
    const down: RateStore = {
      hit: () => Promise.reject(new Error('valkey unreachable')),
    };
    const verdict = await checkRate(down, { scope: 'tenant', id: 't' });
    expect(verdict.allowed).toBe(false);
    const fallback = new MemoryRateStore();
    const budget = { limit: 1, windowSeconds: 60 };
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(true);
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(false);
  });
});
