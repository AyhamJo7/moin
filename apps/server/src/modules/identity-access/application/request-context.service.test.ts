/**
 * `RequestContextService` contract, without a database (P06.06.03).
 *
 * The integration suite proves the full path; these pin the decision table deterministically:
 * exactly one database call per resolution, cached authority bounded by the session's own
 * expiries, the bound holding under churn, and mutations never touching the cache.
 */
import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '@moin/kernel';
import type { IdentityStore, RequestContext } from '@moin/db';
import { RequestContextService } from './request-context.service.ts';

const DIGEST = Buffer.alloc(32, 9);

function rows(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    memberships: [{ organisationId: 'org-1', role: 'owner', permissions: [] }],
    idleExpiresAt: new Date(Date.now() + 3600_000),
    absoluteExpiresAt: new Date(Date.now() + 86400_000),
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
  it('performs exactly one database call per resolution (single query)', async () => {
    const clock = fixedClock(new Date());
    const backend = store();
    const spy = vi.spyOn(backend, 'resolveRequestContext');
    const service = new RequestContextService(backend, clock);
    const outcome = await service.resolve(DIGEST, 'mutate');
    expect('context' in outcome).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(backend.calls()).toBe(1);
  });

  it('serves a cached session only while its expiries are future', async () => {
    const clock = fixedClock(new Date());
    const deadline = clock.now().getTime() + 2_000;
    const backend = store({
      resolveRequestContext: () =>
        // Time-aware stub modelling the DB: valid before the deadline, refused after.
        Promise.resolve(
          clock.now().getTime() < deadline
            ? rows({ idleExpiresAt: new Date(deadline) })
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

  it('bounds the cache deadline by the session expiries, not just the TTL', async () => {
    const clock = fixedClock(new Date());
    const deadline = clock.now().getTime() + 5_000;
    const backend = store({
      resolveRequestContext: () =>
        Promise.resolve(
          clock.now().getTime() < deadline
            ? rows({ idleExpiresAt: new Date(deadline) })
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

  it('never caches mutations and bounds the cache under churn', async () => {
    const clock = fixedClock(new Date());
    const backend = store();
    const service = new RequestContextService(backend, clock);
    const before = backend.calls();
    await service.resolve(DIGEST, 'mutate');
    await service.resolve(DIGEST, 'mutate');
    expect(backend.calls()).toBe(before + 2);
    expect(service.cached).toBe(0);
  });
});
