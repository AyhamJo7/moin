/**
 * The api role's identity pool (P06.06, ADR-0003, INV-01).
 *
 * The platform module is the one place in `apps/server` allowed to hold a raw pool
 * (`only-platform-opens-transactions`). This pool connects as `moin_identity` — never as
 * `moin_app` — because the sign-in and session functions are executable by that role alone. Voice
 * and worker hold `moin_app` and cannot be given this credential (the configuration loader refuses
 * it outside the api role), so no process but api can mint, resolve, rotate or revoke a session.
 *
 * It hands out only the identity store, whose every call is one reviewed `SECURITY DEFINER`
 * function. Tenant work arrives with its own `moin_app` pool behind `withTenant`.
 *
 * Absent when the api does not sign anyone in: the loader requires the credential whenever OIDC is
 * configured, so "no identity pool" can only mean "this deployment has no sign-in".
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createIdentityStore, type IdentityStore } from '@moin/db';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import type { Config } from '../../config/env.ts';

export const IDENTITY_POOL = Symbol('IDENTITY_POOL');
export const IDENTITY_STORE = Symbol('IDENTITY_STORE');

/**
 * Bounds on the pool. Without them a database brownout makes every caller wait for a connection
 * forever, and `app.close()` waits with them until the shutdown grace period forces an exit. Each
 * statement here is one indexed lookup or a short write, so five seconds is generous.
 */
const POOL_MAX_CONNECTIONS = 10;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 5_000;

/** Releases the pool on shutdown, so `app.close()` returns with no socket left open. */
@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(IDENTITY_POOL) private readonly pool: Pool | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

export function createIdentityPool(config: Config): Pool | null {
  if (config.IDENTITY_DATABASE_URL === undefined) return null;
  return createPool({
    connectionString: config.IDENTITY_DATABASE_URL,
    max: POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-identity`,
  });
}

@Module({
  providers: [
    { provide: IDENTITY_POOL, inject: [CONFIG], useFactory: createIdentityPool },
    {
      provide: IDENTITY_STORE,
      inject: [IDENTITY_POOL],
      useFactory: (pool: Pool | null): IdentityStore | null =>
        pool === null ? null : createIdentityStore(pool),
    },
    PoolLifecycle,
  ],
  exports: [IDENTITY_STORE],
})
export class IdentityPoolModule {}
