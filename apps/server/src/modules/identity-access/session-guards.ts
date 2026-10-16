/**
 * The identity module's public guard surface for other modules' routes (P06.06.03, INV-02).
 *
 * A business route outside this module is guarded exactly like the member routes: the session +
 * membership gate resolves the organisation server-side, the account throttle limits one
 * session's rate, the role gate requires an active membership, and the interceptor publishes the resolved tenant for the handler. Exported here so
 * consumers depend on this file, not on this module's `http/` internals.
 */

export { SessionMembershipGuard } from './http/session-membership.guard.ts';
export { RequireRoleGuard } from './http/require-role.guard.ts';
export { AccountThrottleGuard } from './http/auth-throttle.guard.ts';
export { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
