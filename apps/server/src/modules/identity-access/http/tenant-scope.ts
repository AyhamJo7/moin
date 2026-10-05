/**
 * Request-scoped tenant carrier (P06.06.03, INV-01, INV-02).
 *
 * `withTenant` opens a transaction on a caller-supplied client, but a Nest interceptor cannot
 * hold that client across `next.handle()` — the handler's own queries check out their own pooled
 * connections. So this module carries the guard-resolved organisation in an `AsyncLocalStorage`
 * scope for the duration of the request instead: handlers that need tenant data open their own
 * `withTenant(pool, scope.organisationId, …)` around their queries, and the organisation id they
 * pass is the one the guard resolved, never a caller claim.
 *
 * Deliberately narrow: the scope carries identifiers only (organisation, actor), never the session
 * token or any secret. A request outside the scope — health, login, callback — sees `undefined`
 * rather than a default, so unguarded code cannot mistake itself for tenanted.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from '@moin/db/pool';
import { type TenantClient, withTenant } from '@moin/db';

export interface TenantScope {
  readonly organisationId: string;
  readonly actorId: string;
}

const storage = new AsyncLocalStorage<TenantScope>();

/** The guard-resolved tenant of the current request, or undefined outside a guarded request. */
export function currentTenantScope(): TenantScope | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with the guard-resolved tenant visible to `currentTenantScope`. Opens no connection
 * itself: the first `withTenant` inside `fn` sets the database setting on its own client, exactly
 * as it would without this module.
 */
export async function runInTenantScope<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** Convenience for handlers: enter the guard-resolved tenant on the given pool. */
export async function withRequestTenant<T>(
  pool: Pool,
  fn: (client: TenantClient) => Promise<T>,
): Promise<T> {
  const scope = storage.getStore();
  if (scope === undefined) {
    throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
  }
  return withTenant(pool, scope.organisationId, fn, { actorId: scope.actorId });
}
