/**
 * `RequireStepUpGuard` contract, without a database (P06.06.04).
 *
 * The integration suite proves the full path; these pin the decision table deterministically:
 * fresh stamps pass, stale or missing stamps get a 403 with the step-up problem shape, and the
 * check always resolves fresh (mutate mode) whatever the HTTP method.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { fixedClock, type Clock } from '@moin/kernel';
import type { IdentityStore, RequestContext } from '@moin/db';
import { RequestContextService } from '../application/request-context.service.ts';
import { STEP_UP_WINDOW_MS } from '../domain/session-policy.ts';
import { digestOf } from '../domain/secret-values.ts';
import { RequireStepUpGuard } from './require-step-up.guard.ts';

const COOKIE = '__Host-moin_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DIGEST_HEX = digestOf('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').toString('hex');

function rows(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    memberships: [{ organisationId: 'org-1', role: 'owner', permissions: [] }],
    idleExpiresAt: new Date(Date.now() + 3600_000),
    absoluteExpiresAt: new Date(Date.now() + 86400_000),
    stepUpAt: new Date(),
    ...overrides,
  };
}

function store(stepUpAt: Date | null): IdentityStore {
  return {
    beginAuthTransaction: () => Promise.resolve(),
    consumeAuthTransaction: () => Promise.resolve(undefined),
    beginSession: () => Promise.resolve(undefined),
    rotateSession: () => Promise.resolve(undefined),
    resolveSession: () => {
      throw new Error('resolveSession must not be called: single-query invariant');
    },
    revokeSession: () => Promise.resolve(false),
    resolveRequestContext: () => Promise.resolve(rows({ stepUpAt })),
  };
}

interface Sent {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function harness(stepUpAt: Date | null, method = 'POST') {
  const clock = fixedClock(new Date());
  const backend = store(stepUpAt);
  const service = new RequestContextService(backend, clock);
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new RequireStepUpGuard(service, clock, logger as never);
  const sent: Sent = { status: 0, body: undefined, headers: {} };
  const reply = {
    header: (name: string, value: string) => {
      sent.headers[name] = value;
    },
    code: (status: number) => {
      sent.status = status;
      return {
        header: (_name: string, _value: string) => ({
          send: (body: unknown) => {
            sent.body = body;
          },
        }),
      };
    },
  };
  const requests: { cookie: string; mode: string }[] = [];
  const resolving = new RequestContextService(
    {
      ...backend,
      resolveRequestContext: (digest: Buffer) => {
        requests.push({ cookie: digest.toString('hex'), mode: 'mutate-probe' });
        return backend.resolveRequestContext(digest);
      },
    },
    clock,
  );
  const spied = new RequireStepUpGuard(resolving, clock, logger as never);
  const context = (cookie: string = COOKIE) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { cookie },
          method,
          routeOptions: { url: '/probe/step-up' },
        }),
        getResponse: () => reply,
      }),
    }) as unknown as ExecutionContext;
  return { clock, guard, spied, sent, requests, context, logger };
}

describe('RequireStepUpGuard', () => {
  it('passes a stamp inside the window and resolves fresh in mutate mode', async () => {
    const at = new Date();
    const { spied, context, requests, sent, clock } = harness(
      new Date(at.getTime() - STEP_UP_WINDOW_MS + 60_000),
      'GET',
    );
    // A GET must still resolve fresh: sensitive actions never serve the read cache.
    expect(await spied.canActivate(context())).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.cookie).toBe(DIGEST_HEX);
    expect(sent.status).toBe(0);
    void clock;
  });

  it('rejects a stamp older than 15 minutes with the step-up problem', async () => {
    const { guard, context, sent } = harness(new Date(Date.now() - STEP_UP_WINDOW_MS - 1_000));
    expect(await guard.canActivate(context())).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.body).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
  });

  it('rejects a missing stamp and a missing cookie with the same problem', async () => {
    const bare = harness(null);
    expect(await bare.guard.canActivate(bare.context())).toBe(false);
    expect(bare.sent.status).toBe(403);
    expect(bare.sent.body).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
    const noCookie = harness(new Date());
    expect(await noCookie.guard.canActivate(noCookie.context(''))).toBe(false);
    expect(noCookie.sent.status).toBe(403);
  });

  it('answers 503, never 403, when the lookup throws', async () => {
    const clock: Clock = fixedClock(new Date());
    const failing: IdentityStore = {
      ...store(new Date()),
      resolveRequestContext: () => Promise.reject(new Error('pool exhausted')),
    };
    const service = new RequestContextService(failing, clock);
    const sent: Sent = { status: 0, body: undefined, headers: {} };
    const guard = new RequireStepUpGuard(service, clock, {
      error: vi.fn(),
      warn: vi.fn(),
    } as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { cookie: COOKIE },
          method: 'POST',
          routeOptions: { url: '/probe/step-up' },
        }),
        getResponse: () => ({
          header: (name: string, value: string) => {
            sent.headers[name] = value;
          },
          code: (status: number) => {
            sent.status = status;
            return {
              header: (_n: string, _v: string) => ({
                send: (body: unknown) => {
                  sent.body = body;
                },
              }),
            };
          },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(await guard.canActivate(context)).toBe(false);
    expect(sent.status).toBe(503);
    expect(sent.body).toStrictEqual({
      type: '/problems/identity-unavailable',
      title: 'Identity is unavailable',
      status: 503,
    });
  });
});
