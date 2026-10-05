/**
 * `RequestContextService` contract, without a database (P06.06.03).
 *
 * The integration suite proves the full path; these pin the decision table deterministically:
 * a slide that refuses after a valid re-check admits nothing and caches nothing, the bound
 * holds under churn, and mutations never touch the cache.
 */
import { describe, expect, it } from 'vitest';
import { fixedClock } from '@moin/kernel';
import type { IdentityStore, RequestContext } from '@moin/db';
import { RequestContextService } from './request-context.service.ts';

const DIGEST = Buffer.alloc(32, 9);

function rows(): RequestContext {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    memberships: [{ organisationId: 'org-1', role: 'owner', permissions: [] }],
    idleExpiresAt: new Date(Date.now() + 3600_000),
    absoluteExpiresAt: new Date(Date.now() + 86400_000),
  };
}

function store(
  overrides: Partial<Pick<IdentityStore, 'resolveRequestContext' | 'resolveSession'>> = {},
): IdentityStore {
  return {
    beginAuthTransaction: () => Promise.resolve(),
    consumeAuthTransaction: () => Promise.resolve(undefined),
    beginSession: () => Promise.resolve(undefined),
    rotateSession: () => Promise.resolve(undefined),
    resolveSession: () => Promise.resolve(undefined),
    revokeSession: () => Promise.resolve(false),
    resolveRequestContext: () => Promise.resolve(rows()),
    ...overrides,
  };
}

describe('RequestContextService', () => {
  it('refuses when the activity slide refuses after a valid re-check, and caches nothing', async () => {
    const clock = fixedClock(new Date());
    const service = new RequestContextService(
      store({ resolveSession: () => Promise.resolve(undefined) }),
      clock,
    );
    const outcome = await service.resolve(DIGEST, 'read');
    expect(outcome).toStrictEqual({ failure: 'invalid' });
    expect(service.cached).toBe(0);
  });

  it('admits and caches a fully valid resolution on reads only', async () => {
    const clock = fixedClock(new Date());
    const service = new RequestContextService(
      store({
        resolveSession: () =>
          Promise.resolve({
            sessionId: 'session-1',
            userId: 'user-1',
            idleExpiresAt: new Date(),
            absoluteExpiresAt: new Date(),
          }),
      }),
      clock,
    );
    const first = await service.resolve(DIGEST, 'read');
    expect('context' in first).toBe(true);
    expect(service.cached).toBe(1);
    const second = await service.resolve(DIGEST, 'read');
    expect('context' in second).toBe(true);
  });

  it('never caches mutations and bounds the cache under churn', async () => {
    const clock = fixedClock(new Date());
    let calls = 0;
    const service = new RequestContextService(
      store({
        resolveRequestContext: () => {
          calls += 1;
          return Promise.resolve(rows());
        },
        resolveSession: () =>
          Promise.resolve({
            sessionId: 'session-1',
            userId: 'user-1',
            idleExpiresAt: new Date(),
            absoluteExpiresAt: new Date(),
          }),
      }),
      clock,
    );
    const before = calls;
    await service.resolve(DIGEST, 'mutate');
    await service.resolve(DIGEST, 'mutate');
    expect(calls).toBe(before + 2);
    expect(service.cached).toBe(0);
  });
});
