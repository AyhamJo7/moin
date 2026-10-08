/**
 * Route inventory for the cross-tenant suite (P06.13.02).
 *
 * Read from the controller classes the Nest app actually mounts — the same metadata the
 * guards read — never from a hand-kept list. A route added without an entry here fails the
 * coverage test instead of passing silently. Each entry names the cross-tenant probe:
 * call as tenant A with tenant B's resource id and expect the leak-proof answer.
 *
 * Route classes:
 * - `tenant-id`: takes a tenant-B resource id; expect 404 or empty (never B's data).
 * - `tenant-create`: creates a row in the CALLER's tenant; expect success AND prove the
 *   row landed in A (not B) by reading it back scoped to A. Invite is the only such
 *   route today: it takes an email, not an id, so there is no foreign id to forge —
 *   the leak to rule out is creation landing in (or reading from) the wrong tenant.
 * - `tenant-list`: lists the caller's own rows; expect A's rows only, B's absent.
 * - `public`: no tenant scope (login, callback, health); cross-tenant N/A — but the test
 *   still calls it to prove it answers without leaking (no tenant data in body).
 * - `signature`: Twilio-signed webhook; expect 401/403 on a forged signature.
 */

export type RouteClass = 'tenant-id' | 'tenant-list' | 'tenant-create' | 'public' | 'signature';

export interface InventoriedRoute {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly class: RouteClass;
  /** For `tenant-id`: which seeded id of tenant B to present (`invitation` | `grant` | `user`). */
  readonly foreignId?: 'invitation' | 'grant' | 'user' | undefined;
  /** Minimal valid body; the foreign id is merged into it by the probe. */
  readonly body?: Record<string, unknown> | undefined;
}

/**
 * The full inventory, one row per route on the API surface today. Controllers mounted:
 * auth (4), members (5), recovery (3), support (3), health (2), voice (2). The coverage
 * test pins this list against Nest metadata (`INVENTORY.length` vs reflected routes), so
 * a new route without a row fails loudly.
 */
export const INVENTORY: readonly InventoriedRoute[] = [
  // auth — public entry points; callback refusal must not leak which tenant (if any).
  { method: 'GET', path: '/api/auth/login', class: 'public' },
  { method: 'GET', path: '/api/auth/callback', class: 'public' },
  // auth — session routes; step-up/sign-out-others act on the caller's own session only.
  { method: 'POST', path: '/api/auth/step-up', class: 'tenant-list' },
  { method: 'POST', path: '/api/auth/sign-out-others', class: 'tenant-list' },
  // members — caller-tenant scoped; foreign user ids must 404 (HIGH1). Invite creates
  // in the caller's tenant (tenant-create, not tenant-id: email, not an id).
  {
    method: 'POST',
    path: '/api/members/invite',
    class: 'tenant-create',
    body: { email: 'stranger@example.test', role: 'staff' },
  },
  {
    method: 'POST',
    path: '/api/members/invitations/:id/revoke',
    class: 'tenant-id',
    foreignId: 'invitation',
  },
  {
    method: 'POST',
    path: '/api/members/disable',
    class: 'tenant-id',
    foreignId: 'user',
    body: { reason: 'leaver' },
  },
  {
    method: 'POST',
    path: '/api/members/remove',
    class: 'tenant-id',
    foreignId: 'user',
  },
  {
    method: 'POST',
    path: '/api/members/transfer-ownership',
    class: 'tenant-id',
    foreignId: 'user',
  },
  // recovery — caller-tenant membership gate (HIGH1); foreign user ids must 404.
  {
    method: 'POST',
    path: '/api/recovery/disable-user',
    class: 'tenant-id',
    foreignId: 'user',
    body: { reason: 'password_reset' },
  },
  {
    method: 'POST',
    path: '/api/recovery/enable-user',
    class: 'tenant-id',
    foreignId: 'user',
    body: { reason: 'password_reset' },
  },
  {
    method: 'POST',
    path: '/api/recovery/revoke-sessions',
    class: 'tenant-id',
    foreignId: 'user',
    body: { reason: 'password_reset' },
  },
  // support — creating a grant writes into the CALLER's tenant (tenant-create, like
  // invite: the leak to rule out is landing in the wrong tenant); list shows the
  // caller's own live grants only; revoke of B's id 404s.
  {
    method: 'POST',
    path: '/api/support/grants',
    class: 'tenant-create',
    body: {
      operatorSubject: 'xsuite-probe-operator',
      scope: 'readonly',
      reason: 'cross-tenant probe grant creation',
    },
  },
  {
    method: 'POST',
    path: '/api/support/grants/:id/revoke',
    class: 'tenant-id',
    foreignId: 'grant',
  },
  { method: 'GET', path: '/api/support/grants', class: 'tenant-list' },
  // health — unauthenticated, thin bodies, no tenant data by construction.
  { method: 'GET', path: '/healthz', class: 'public' },
  { method: 'GET', path: '/readyz', class: 'public' },
  // voice — Twilio-signed; forged signature must 401/403, never reach tenancy.
  { method: 'POST', path: '/voice/inbound', class: 'signature' },
  { method: 'POST', path: '/voice/session-end', class: 'signature' },
];

/** `INVENTORY.length` today: the coverage test pins this so a silent shrink fails. */
export const EXPECTED_ROUTE_COUNT = 19;
