/**
 * The access policy of every route the production roots serve (P06.07.05, security acceptance
 * G09 M4).
 *
 * The RBAC matrix used to be generated from a hand-kept controller list, so a route in any
 * other module, or a new controller, escaped it. Now `route-policy.test.ts` derives the served
 * routes from the production root modules (the same source as the cross-tenant inventory) and
 * requires each to appear here exactly once, classified as one of three kinds:
 *
 * - `capabilities`: the route is declared with `@Require(...)` for exactly these capabilities,
 *   and the real-route RBAC matrix drives it for every role.
 * - `serviceLevel`: the route is open to every authenticated member by design and its authority
 *   is judged inside the service against the data (staff reach only their own or unassigned
 *   tasks, for example). The entry names the reason and the integration test that proves it.
 *   `RequireRoleGuard` admits a route with no declared capability, so this classification is
 *   what stops a forgotten `@Require` from passing unnoticed.
 * - `public`: no session and no capability; the entry names what authenticates the caller
 *   instead (a provider signature, a development token) or why nothing needs to.
 *
 * Update a row only with a PLAN reason; a new route without a row fails the policy test.
 */

import type { Capability } from '../modules/identity-access/domain/roles.ts';

export type RoutePolicy =
  | { readonly capabilities: readonly Capability[] }
  | { readonly serviceLevel: string; readonly provenBy: string }
  | { readonly public: string };

const TASK_RULE =
  'owners and admins act on any task of the tenant, staff only on tasks assigned to themselves or unassigned, judged on the row-locked task in the service (PLAN: Act on tasks)';

export const ROUTE_POLICY: Readonly<Record<string, RoutePolicy>> = {
  // Members: the owner-only transfer needs the owner capability; the rest user management.
  'POST /api/members/invite': { capabilities: ['users:manage'] },
  'POST /api/members/invitations/:id/revoke': { capabilities: ['users:manage'] },
  'POST /api/members/disable': { capabilities: ['users:manage'] },
  'POST /api/members/remove': { capabilities: ['users:manage'] },
  'POST /api/members/transfer-ownership': { capabilities: ['users:manage-owners'] },
  // Recovery.
  'POST /api/recovery/disable-user': { capabilities: ['users:manage'] },
  'POST /api/recovery/enable-user': { capabilities: ['users:manage'] },
  'POST /api/recovery/revoke-sessions': { capabilities: ['users:manage'] },
  // Support access grants.
  'POST /api/support/grants': { capabilities: ['support:grant'] },
  'POST /api/support/grants/:id/revoke': { capabilities: ['support:grant'] },
  'GET /api/support/grants': { capabilities: ['support:grant'] },
  // Session routes: every role holds them by design (the matrix grants session:* to all three).
  'POST /api/auth/step-up': { capabilities: ['session:step-up'] },
  'POST /api/auth/sign-out-others': { capabilities: ['session:sign-out-others'] },
  // Work: authority is the service's, judged against the task.
  'GET /api/today': {
    serviceLevel:
      'a member reads their own tenant’s today list; tenant scope from the session, never the request',
    provenBy: 'apps/server/src/modules/work/callback-today.integration.test.ts',
  },
  'GET /api/tasks/:id': {
    serviceLevel: TASK_RULE,
    provenBy: 'apps/server/src/modules/work/owner-completes-callback.integration.test.ts',
  },
  'POST /api/tasks/:id/complete': {
    serviceLevel: TASK_RULE,
    provenBy: 'apps/server/src/modules/work/owner-completes-callback.integration.test.ts',
  },
  // Public entry points.
  'GET /api/auth/login': { public: 'starts the provider sign-in; no session exists yet' },
  'GET /api/auth/callback': { public: 'completes the provider sign-in; no session exists yet' },
  'GET /healthz': { public: 'liveness probe; no tenant data' },
  'GET /readyz': { public: 'readiness probe; no tenant data' },
  'POST /voice/inbound': { public: 'authenticated by the Twilio request signature' },
  'POST /voice/session-end': { public: 'authenticated by the Twilio request signature' },
  'POST /api/dev/simulated-calls': {
    public: 'development simulator, authenticated by its bearer token and inert unless configured',
  },
};
