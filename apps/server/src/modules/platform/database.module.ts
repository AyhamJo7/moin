/**
 * The runtime database pool (INV-01, INV-02).
 *
 * The platform module is the one place in `apps/server` allowed to hold a raw pool
 * (`only-platform-opens-transactions`). It connects as the configured runtime role — `moin_app`,
 * NOBYPASSRLS — and hands out only narrower things built on it: today the identity store, whose
 * every call is one reviewed `SECURITY DEFINER` function; the tenant wrapper joins it when the
 * first business module needs tenant data.
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createIdentityStore, type IdentityStore } from '@moin/db';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import type { Config } from '../../config/env.ts';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

/**
 * Bounds on the runtime pool. Without them a database brownout makes every caller wait for a
 * connection forever, and `app.close()` waits with them until the shutdown grace period forces an
 * exit. Each statement here is one indexed lookup or a short write, so five seconds is generous.
 */
const POOL_MAX_CONNECTIONS = 10;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 5_000;
export const IDENTITY_STORE = Symbol('IDENTITY_STORE');

/** Releases the pool on shutdown, so `app.close()` returns with no socket left open. */
@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool =>
        createPool({
          connectionString: config.DATABASE_URL,
          max: POOL_MAX_CONNECTIONS,
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
          idleTimeoutMillis: IDLE_TIMEOUT_MS,
          statement_timeout: STATEMENT_TIMEOUT_MS,
          application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}`,
        }),
    },
    {
      provide: IDENTITY_STORE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): IdentityStore => createIdentityStore(pool),
    },
    PoolLifecycle,
  ],
  exports: [IDENTITY_STORE],
})
export class PlatformDatabaseModule {}
