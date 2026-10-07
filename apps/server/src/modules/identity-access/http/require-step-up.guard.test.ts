/**
 * `RequireStepUpGuard` contract, without a database (P06.06.04).
 *
 * The guard reads the verdict the first guard attached: freshness was judged by the database
 * clock inside `resolve_request_context`, so these pin the decision table — fresh passes,
 * stale or absent refuses with the step-up problem shape — without touching time at all.
 * The integration suite proves the end-to-end path including the DB freshness judgment.
 */
import { describe, expect, vi } from 'vitest';
import { evidenceTest } from '@moin/testing';
import type { ExecutionContext } from '@nestjs/common';
import type { SessionContext } from '../application/request-context.service.ts';
import { RequireStepUpGuard } from './require-step-up.guard.ts';

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

interface Sent {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function harness(attached: SessionContext | undefined) {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new RequireStepUpGuard(logger as never);
  const sent: Sent = { status: 0, body: undefined, headers: {} };
  const reply = {
    header: (name: string, value: string) => {
      sent.headers[name] = value;
    },
    code: (status: number) => {
      sent.status = status;
      return {
        header: () => ({
          send: (body: unknown) => {
            sent.body = body;
          },
        }),
      };
    },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        method: 'POST',
        routeOptions: { url: '/probe/sensitive' },
        sessionContext: attached,
      }),
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { guard, sent, context, logger };
}

describe('RequireStepUpGuard', () => {
  evidenceTest('passes a fresh verdict from the first guard', async () => {
    const { guard, context, sent } = harness(session());
    expect(await guard.canActivate(context)).toBe(true);
    expect(sent.status).toBe(0);
  });

  evidenceTest('rejects a stale verdict with the step-up problem', async () => {
    const { guard, context, sent } = harness(session({ stepUpFresh: false }));
    expect(await guard.canActivate(context)).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.body).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
  });

  evidenceTest('rejects a missing context with the same problem', async () => {
    const { guard, context, sent } = harness(undefined);
    expect(await guard.canActivate(context)).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.body).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
  });
});
