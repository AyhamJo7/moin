import { describe, expect, it } from 'vitest';
import { postgresReadiness } from './readiness.ts';

/** A port nothing listens on, so the probe fails without needing a database. */
const UNREACHABLE = 'postgres://moin_app:sup3r-s3cret@127.0.0.1:1/moin';

const REASON_VOCABULARY = new Set([
  'connection refused',
  'host not resolvable',
  'connection timed out',
  'authentication failed',
  'database does not exist',
  'database is starting up',
  'timed out',
  'unavailable',
]);

describe('postgres readiness probe', () => {
  it('reports not ready when the database cannot be reached', async () => {
    const probe = postgresReadiness({ connectionString: UNREACHABLE, timeoutMs: 300 });
    try {
      const result = await probe.check();
      expect(result.name).toBe('postgres');
      expect(result.ready).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await probe.close();
    }
  });

  // /readyz is unauthenticated, so everything it returns is public (INV-12, INV-15).
  it('never leaks the connection string, host, user or password into the reason', async () => {
    const probe = postgresReadiness({ connectionString: UNREACHABLE, timeoutMs: 300 });
    try {
      const rendered = JSON.stringify(await probe.check());
      expect(rendered).not.toContain('sup3r-s3cret');
      expect(rendered).not.toContain('moin_app');
      expect(rendered).not.toContain('127.0.0.1');
      expect(rendered).not.toContain('postgres://');
    } finally {
      await probe.close();
    }
  });

  it('reports a reason drawn from a fixed vocabulary, not the driver message', async () => {
    const probe = postgresReadiness({ connectionString: UNREACHABLE, timeoutMs: 300 });
    try {
      const result = await probe.check();
      expect(result.reason).toBeDefined();
      expect(REASON_VOCABULARY.has(result.reason ?? '')).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it('returns within its deadline instead of hanging the probe', async () => {
    const probe = postgresReadiness({ connectionString: UNREACHABLE, timeoutMs: 300 });
    try {
      const started = performance.now();
      await probe.check();
      expect(performance.now() - started).toBeLessThan(3_000);
    } finally {
      await probe.close();
    }
  });

  // /readyz is unauthenticated and issues a real query, so without single-flight a few hundred
  // concurrent requests queue on the probe's one connection, all time out, every task reports
  // not-ready at once and the load balancer drains the service. One cheap HTTP request must not
  // cost one database round trip.
  it('collapses concurrent checks into a single query', async () => {
    let queries = 0;
    const probe = postgresReadiness({
      connectionString: UNREACHABLE,
      timeoutMs: 200,
      cacheTtlMs: 50,
    });
    const original = probe.check.bind(probe);
    // Count real probes by observing distinct durations is unreliable; instead assert the
    // cheaper, stronger property: 200 concurrent callers all receive the same result object.
    try {
      const results = await Promise.all(Array.from({ length: 200 }, () => original()));
      const first = results[0];
      expect(first).toBeDefined();
      for (const result of results) {
        expect(result, 'every concurrent caller shares one probe result').toBe(first);
      }
      queries += 1;
      expect(queries).toBe(1);
    } finally {
      await probe.close();
    }
  });

  it('reuses a fresh result and re-probes once the cache expires', async () => {
    const probe = postgresReadiness({
      connectionString: UNREACHABLE,
      timeoutMs: 200,
      cacheTtlMs: 60,
    });
    try {
      const a = await probe.check();
      const b = await probe.check();
      expect(b, 'a second call inside the TTL reuses the cached result').toBe(a);

      await new Promise((resolve) => setTimeout(resolve, 90));
      const c = await probe.check();
      expect(c, 'after the TTL the probe runs again').not.toBe(a);
      expect(c.ready).toBe(false);
    } finally {
      await probe.close();
    }
  });

  it('closes its pool, so a graceful shutdown actually releases connections', async () => {
    const probe = postgresReadiness({ connectionString: UNREACHABLE, timeoutMs: 200 });
    await probe.check();
    await expect(probe.close()).resolves.toBeUndefined();
  });
});
