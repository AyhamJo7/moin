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
});
