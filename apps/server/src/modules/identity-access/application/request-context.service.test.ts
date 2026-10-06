/**
 * `RequestContextService` contract, without a database (P06.06.03).
 *
 * The integration suite proves the full path; these pin the decision table deterministically:
 * exactly one database call per resolution, cached authority bounded by the session's own
 * expiries, the bound holding under churn, and mutations never touching the cache.
 */
import { describe, expect, vi } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import type { IdentityStore, RequestContext } from '@moin/db';
import { RequestContextService } from './request-context.service.ts';

const DIGEST = Buffer.alloc(32, 9);

function rows(overrides: Partial<RequestContext> = {}): RequestContext {
  const nowMs = overrides.stepUpAt?.getTime() ?? Date.now();
  const idleExpiresAt = overrides.idleExpiresAt ?? new Date(nowMs + 3600_000);
  const absoluteExpiresAt = overrides.absoluteExpiresAt ?? new Date(nowMs + 86400_000);
  const idleRemainingSeconds =
    overrides.idleRemainingSeconds ??
    Math.max(0, Math.round((idleExpiresAt.getTime() - nowMs) / 1000));
  const absoluteRemainingSeconds =
    overrides.absoluteRemainingSeconds ??
    Math.max(0, Math.round((absoluteExpiresAt.getTime() - nowMs) / 1000));
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    memberships: [{ organisationId: 'org-1', role: 'owner', permissions: [] }],
    idleExpiresAt,
    absoluteExpiresAt,
    stepUpAt: new Date(nowMs),
    stepUpFresh: true,
    stepUpRemainingSeconds: 900,
    idleRemainingSeconds,
    absoluteRemainingSeconds,
    ...overrides,
  };
}

function store(
  overrides: Partial<Pick<IdentityStore, 'resolveRequestContext'>> = {},
): IdentityStore & { calls: () => number } {
  let calls = 0;
  const base: IdentityStore = {
    beginAuthTransaction: () => Promise.resolve(),
    consumeAuthTransaction: () => Promise.resolve(undefined),
    beginSession: () => Promise.resolve(undefined),
    rotateSession: () => Promise.resolve(undefined),
    resolveSession: () => {
      throw new Error('resolveSession must not be called: single-query invariant');
    },
    revokeSession: () => Promise.resolve(false),
    resolveRequestContext: () => {
      calls += 1;
      return Promise.resolve(rows());
    },
    ...overrides,
  };
  return { ...base, calls: () => calls };
}

describe('RequestContextService', () => {
  evidenceTest('performs exactly one database call per resolution (single query)', async () => {
    const clock = fixedClock(new Date());
    const backend = store();
    const spy = vi.spyOn(backend, 'resolveRequestContext');
    const service = new RequestContextService(backend, clock);
    const outcome = await service.resolve(DIGEST, 'mutate');
    expect('context' in outcome).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(backend.calls()).toBe(1);
  });

  evidenceTest('serves a cached session only while its expiries are future', async () => {
    const clock = fixedClock(new Date());
    const deadline = clock.now().getTime() + 2_000;
    const backend = store({
      resolveRequestContext: () =>
        // Time-aware stub modelling the DB: valid before the deadline, refused after.
        Promise.resolve(
          clock.now().getTime() < deadline
            ? rows({ idleExpiresAt: new Date(deadline), idleRemainingSeconds: 2 })
            : undefined,
        ),
    });
    const spy = vi.spyOn(backend, 'resolveRequestContext');
    const service = new RequestContextService(backend, clock);
    expect('context' in (await service.resolve(DIGEST, 'read'))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    clock.advance(2_500);
    // Cached entry lapsed WITH the session: re-resolved, refused, nothing served, nothing cached.
    const outcome = await service.resolve(DIGEST, 'read');
    expect(outcome).toStrictEqual({ failure: 'invalid' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(service.cached).toBe(0);
  });

  evidenceTest('bounds the cache deadline by the session expiries, not just the TTL', async () => {
    const clock = fixedClock(new Date());
    const deadline = clock.now().getTime() + 5_000;
    const backend = store({
      resolveRequestContext: () =>
        Promise.resolve(
          clock.now().getTime() < deadline
            ? rows({ idleExpiresAt: new Date(deadline), idleRemainingSeconds: 5 })
            : undefined,
        ),
    });
    const service = new RequestContextService(backend, clock);
    const spy = vi.spyOn(backend, 'resolveRequestContext');
    await service.resolve(DIGEST, 'read');
    expect(spy).toHaveBeenCalledTimes(1);
    clock.advance(6_000);
    // TTL (30 s) not yet reached, but the session expired: must re-resolve, never serve stale.
    await service.resolve(DIGEST, 'read');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  evidenceTest('invalidates the cached entry on the mutate path', async () => {
    const clock = fixedClock(new Date());
    const backend = store();
    const service = new RequestContextService(backend, clock);
    expect('context' in (await service.resolve(DIGEST, 'read'))).toBe(true);
    expect(service.cached).toBe(1);
    await service.resolve(DIGEST, 'mutate');
    expect(service.cached).toBe(0);
  });

  evidenceTest('never caches mutations and bounds the cache under churn', async () => {
    const clock = fixedClock(new Date());
    const backend = store();
    const service = new RequestContextService(backend, clock);
    const before = backend.calls();
    await service.resolve(DIGEST, 'mutate');
    await service.resolve(DIGEST, 'mutate');
    expect(backend.calls()).toBe(before + 2);
    expect(service.cached).toBe(0);
  });

  evidenceTest('carries the step-up stamp and freshness into the session context', async () => {
    const clock = fixedClock(new Date());
    const fresh = new RequestContextService(
      store({ resolveRequestContext: () => Promise.resolve(rows()) }),
      clock,
    );
    const stamped = await fresh.resolve(DIGEST, 'mutate');
    expect('context' in stamped && stamped.context.stepUpAt).toBeInstanceOf(Date);
    expect('context' in stamped && stamped.context.stepUpFresh).toBe(true);
    const bare = new RequestContextService(
      store({
        resolveRequestContext: () =>
          Promise.resolve(
            rows({ stepUpAt: null, stepUpFresh: false, stepUpRemainingSeconds: null }),
          ),
      }),
      clock,
    );
    const unstamped = await bare.resolve(DIGEST, 'mutate');
    expect('context' in unstamped && unstamped.context.stepUpAt).toBeNull();
    expect('context' in unstamped && unstamped.context.stepUpFresh).toBe(false);
  });

  evidenceTest('refuses a cached verdict past the stamp expiry, inside the 30 s TTL', async () => {
    const clock = fixedClock(new Date());
    // The database reports 10 s of step-up budget remaining; after 15 s of local elapsed
    // time the served verdict flips stale — inside the 30 s TTL, with no new lookup.
    const backend = store({
      resolveRequestContext: () =>
        Promise.resolve(rows({ stepUpRemainingSeconds: 10, stepUpFresh: true })),
    });
    const service = new RequestContextService(backend, clock);
    const spy = vi.spyOn(backend, 'resolveRequestContext');
    const first = await service.resolve(DIGEST, 'read');
    expect('context' in first && first.context.stepUpFresh).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    clock.advance(15_000);
    // The 10 s budget elapsed, but the 30 s cache TTL still has 15 s left. The entry is
    // served with stepUpFresh flipped false — no new lookup, and the guard 403s on it.
    const second = await service.resolve(DIGEST, 'read');
    expect(spy).toHaveBeenCalledTimes(1);
    expect('context' in second && second.context.stepUpFresh).toBe(false);
  });

  evidenceTest(
    'an unstamped session reuses a read-only cache entry without gaining step-up',
    async () => {
      const clock = fixedClock(new Date());
      const backend = store({
        resolveRequestContext: () =>
          Promise.resolve(
            rows({ stepUpAt: null, stepUpFresh: false, stepUpRemainingSeconds: null }),
          ),
      });
      const service = new RequestContextService(backend, clock);
      const spy = vi.spyOn(backend, 'resolveRequestContext');
      const first = await service.resolve(DIGEST, 'read');
      expect('context' in first && first.context.stepUpFresh).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      clock.advance(10_000);
      const second = await service.resolve(DIGEST, 'read');
      expect(spy).toHaveBeenCalledTimes(1);
      expect('context' in second && second.context.stepUpFresh).toBe(false);
    },
  );

  evidenceTest(
    'monotonic TTL enforcement: wall-clock adjustment cannot extend cached authority past 30 s',
    async () => {
      const start = new Date();
      const clock = fixedClock(start);
      let membershipActive = true;
      const backend = store({
        resolveRequestContext: () => Promise.resolve(membershipActive ? rows() : undefined),
      });
      const service = new RequestContextService(backend, clock);
      const spy = vi.spyOn(backend, 'resolveRequestContext');
      const first = await service.resolve(DIGEST, 'read');
      expect('context' in first).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      membershipActive = false;
      // Monotonic time advances by 31 seconds, but wall clock adjusted to start + 21 seconds
      clock.advance(31_000);
      clock.set(new Date(start.getTime() + 21_000));

      const second = await service.resolve(DIGEST, 'read');
      expect(second).toStrictEqual({ failure: 'invalid' });
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );

  evidenceTest(
    'monotonic session expiry enforcement: wall-clock adjustment cannot extend authority past session deadline',
    async () => {
      const start = new Date();
      const clock = fixedClock(start);
      const deadline = new Date(start.getTime() + 2_000);
      let valid = true;
      const backend = store({
        resolveRequestContext: () =>
          Promise.resolve(
            valid ? rows({ absoluteExpiresAt: deadline, absoluteRemainingSeconds: 2 }) : undefined,
          ),
      });
      const service = new RequestContextService(backend, clock);
      const spy = vi.spyOn(backend, 'resolveRequestContext');
      const first = await service.resolve(DIGEST, 'read');
      expect('context' in first).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      valid = false;
      // Monotonic time advances past 2s deadline (2.5s), wall clock adjusted to start + 1s
      clock.advance(2_500);
      clock.set(new Date(start.getTime() + 1_000));

      const second = await service.resolve(DIGEST, 'read');
      expect(second).toStrictEqual({ failure: 'invalid' });
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );

  evidenceTest(
    'database session deadline must bound cache lifetime with application clock behind',
    async () => {
      const dbNow = new Date('2026-10-06T20:00:00.000Z');
      const appStart = new Date(dbNow.getTime() - 5_000);
      const clock = fixedClock(appStart);
      const deadline = new Date(dbNow.getTime() + 2_000);
      let valid = true;
      const backend = store({
        resolveRequestContext: () =>
          Promise.resolve(
            valid
              ? rows({
                  idleExpiresAt: deadline,
                  absoluteExpiresAt: deadline,
                  idleRemainingSeconds: 2,
                  absoluteRemainingSeconds: 2,
                })
              : undefined,
          ),
      });
      const service = new RequestContextService(backend, clock);
      const spy = vi.spyOn(backend, 'resolveRequestContext');
      const first = await service.resolve(DIGEST, 'read');
      expect('context' in first).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      valid = false;
      // Monotonic time advances past 2s deadline (2.5s)
      clock.advance(2_500);

      const second = await service.resolve(DIGEST, 'read');
      expect(second).toStrictEqual({ failure: 'invalid' });
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );
});
