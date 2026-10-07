/**
 * `RequireRoleGuard` contract, without a database (P06.07.02).
 *
 * The guard reads the role the first guard attached; these pin the decision — decorated routes
 * refuse insufficient roles with the forbidden problem shape, undecorated routes pass — without
 * touching the database. The integration suite proves the end-to-end path.
 */
import { describe, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { evidenceTest } from '@moin/testing';
import type { ExecutionContext } from '@nestjs/common';
import type { SessionContext } from '../application/request-context.service.ts';
import { RequireRoleGuard } from './require-role.guard.ts';
import { CAPABILITIES_KEY } from './role.ts';

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

function harness(attached: SessionContext | undefined, capabilities: readonly string[] = []) {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const guard = new RequireRoleGuard(new Reflector(), logger as never);
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
        routeOptions: { url: '/probe/admin' },
        sessionContext: attached,
      }),
      getResponse: () => reply,
    }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
  vi.spyOn(Reflector.prototype, 'getAllAndOverride').mockReturnValue(capabilities);
  return { guard, context, sent, logger };
}

describe('RequireRoleGuard (P06.07.02)', () => {
  evidenceTest('undecorated routes pass any active membership', async () => {
    const { guard, context } = harness(session({ role: 'staff' }), []);
    expect(await guard.canActivate(context)).toBe(true);
  });

  evidenceTest('a staff member fails an owner route with 403 forbidden', async () => {
    const { guard, context, sent } = harness(session({ role: 'staff' }), ['tenant:terminate']);
    expect(await guard.canActivate(context)).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.body).toStrictEqual({
      type: '/problems/forbidden',
      title: 'Forbidden',
      status: 403,
    });
    expect(sent.headers['cache-control']).toBe('no-store');
  });

  evidenceTest('an owner passes, and permissions extend admins', async () => {
    const owner = harness(session({ role: 'owner' }), ['billing:manage']);
    expect(await owner.guard.canActivate(owner.context)).toBe(true);
    const admin = harness(session({ role: 'admin', permissions: ['billing_admin'] }), [
      'billing:manage',
    ]);
    expect(await admin.guard.canActivate(admin.context)).toBe(true);
    const denied = harness(session({ role: 'admin' }), ['billing:manage']);
    expect(await denied.guard.canActivate(denied.context)).toBe(false);
  });

  evidenceTest('no session fails closed without naming the route', async () => {
    const { guard, context, sent } = harness(undefined, ['tenant:terminate']);
    expect(await guard.canActivate(context)).toBe(false);
    expect(sent.status).toBe(403);
  });
});
