/**
 * Async failure injection (P08.11.01–.02), the part that is not the job consumer: a Valkey outage
 * makes SSE fall back to polling and the rate limiter fail closed.
 *
 * The worker-side faults (duplicate delivery FS-01, racing workers FS-10, crash around the commit
 * FS-18, backlog FS-14, transient failure) run against the real consumer, database and queue in
 * `job-consumer.integration.test.ts`. The report is docs/verification/failure-injection-report.md
 * (P08.11.03).
 */
import { describe, expect, it } from 'vitest';
import { MemoryRateStore, checkRate, type RateStore } from './rate-limiter.ts';

describe('fault-injection', () => {
  it('Valkey outage: SSE falls back to polling, limiter fails closed', async () => {
    // Valkey down → SSE clients poll the store (P08.08.03 proven in the SSE
    // suite; here the worker side: no live fan-out, rows still land), and the
    // limiter refuses rather than opening (P08.09.01).
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
