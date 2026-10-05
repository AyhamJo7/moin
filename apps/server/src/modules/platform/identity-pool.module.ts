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
 * Absent when `IDENTITY_DATABASE_URL` is not set. The loader does not require it — the verified
 * P06.05.04 configuration contract stays as it is — so the one place that does is
 * `buildSignInGate`: an api with OIDC and no identity pool refuses to start. `/readyz` checks the
 * pool connects as `moin_identity` and that `moin_app` cannot execute the session functions.
 *
 * Before the store exists the pool must pass the same assertion once (`verifyIdentityPool`): a
 * credential for another role, an extra grant or a privileged attribute refuses startup rather than
 * waiting for the first sign-in.
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createIdentityStore, IDENTITY_POOL_ASSERTION, type IdentityStore } from '@moin/db';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, type Config } from '../../config/env.ts';

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

/**
 * Refuses an identity pool whose credential is not the restricted `moin_identity`. Closes the pool
 * and reports a fixed message: the driver's error can carry the host and the user (INV-12, INV-15).
 */
export async function verifyIdentityPool(pool: Pool): Promise<void> {
  const ok = await pool.query<{ ok: boolean }>(IDENTITY_POOL_ASSERTION).then(
    (result) => result.rows[0]?.ok === true,
    () => false,
  );
  if (ok) return;
  await pool.end();
  throw new ConfigurationError([
    'IDENTITY_DATABASE_URL: the pool is not moin_identity limited to the seven session functions, or the database is unreachable',
  ]);
}

@Module({
  providers: [
    { provide: IDENTITY_POOL, inject: [CONFIG], useFactory: createIdentityPool },
    {
      provide: IDENTITY_STORE,
      inject: [IDENTITY_POOL],
      useFactory: async (pool: Pool | null): Promise<IdentityStore | null> => {
        if (pool === null) return null;
        await verifyIdentityPool(pool);
        return createIdentityStore(pool);
      },
    },
    PoolLifecycle,
  ],
  exports: [IDENTITY_STORE],
})
export class IdentityPoolModule {}
