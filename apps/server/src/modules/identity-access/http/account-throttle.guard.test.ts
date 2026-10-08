/**
 * `AccountThrottleGuard` contract, without a database (P06.12.01 review fix).
 *
 * The account guard reads the verified subject from `request.sessionContext` — set only by
 * `SessionMembershipGuard`. These pin the decision table without touching the database: an
 * admitted session consumes the account bucket (spy the scope), a request with no subject is
 * refused (false), never silently skipped — a mis-mount before the session guard reads as
 * refusal, not missing protection. The integration suite proves the take against Postgres.
 */
import { describe, expect, vi } from 'vitest';
import { evidenceTest } from '@moin/testing';
import type { ExecutionContext } from '@nestjs/common';
import type { SessionContext } from '../application/request-context.service.ts';
import { AccountThrottleGuard } from './auth-throttle.guard.ts';

const LOCAL_KEY = 'local-v1:local-development-only';

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    organisationId: 'org-1',
    role: 'owner',
    permissions: [],
    stepUpAt: new Date(),
    stepUpFresh: true,
    ...overrides,
  };
}

function harness(attached: SessionContext | undefined) {
  const calls: string[] = [];
  const store = {
    take: (scope: 'ip' | 'account') => {
      calls.push(scope);
      return Promise.resolve({ allowed: true, retryAfterMs: 0 });
    },
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new AccountThrottleGuard(
    store as never,
    { AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY } as never,
    logger as never,
  );
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        routeOptions: { url: '/api/members/invite' },
        sessionContext: attached,
      }),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
  return { guard, context, calls, logger };
}

describe('AccountThrottleGuard', () => {
  evidenceTest('an admitted session consumes the account bucket', async () => {
    const { guard, context, calls } = harness(session());
    expect(await guard.canActivate(context)).toBe(true);
    expect(calls).toStrictEqual(['account']);
  });

  evidenceTest('a request with no subject is refused, never skipped', async () => {
    const { guard, context, calls, logger } = harness(undefined);
    expect(await guard.canActivate(context)).toBe(false);
    expect(calls).toStrictEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
