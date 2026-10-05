/**
 * The api role's tenant pool (P06.06.03, INV-01, INV-02).
 *
 * The one place in `apps/server` allowed to hold a raw `moin_app` pool beside the identity pool
 * (`only-platform-opens-transactions` permits `modules/platform`). It connects as `moin_app` —
 * NOBYPASSRLS, owning no tables — and is used only inside `withTenant`, so every query it serves
 * is filtered by the database policy for exactly one organisation. The loader requires
 * `DATABASE_URL` for the api role, like every other role; a guarded request without this pool
 * fails closed in the interceptor rather than running unscoped.
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import { type Config } from '../../config/env.ts';

export const TENANT_POOL = Symbol('TENANT_POOL');

const POOL_MAX_CONNECTIONS = 10;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 5_000;

/** Releases the pool on shutdown, so `app.close()` returns with no socket left open. */
@Injectable()
class TenantPoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

export function createTenantPool(config: Config): Pool | null {
  if (config.SERVER_ROLE !== 'api') return null;
  return createPool({
    connectionString: config.DATABASE_URL,
    max: POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-tenant`,
  });
}

@Module({
  providers: [
    {
      provide: TENANT_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool | null => createTenantPool(config),
    },
    TenantPoolLifecycle,
  ],
  exports: [TENANT_POOL],
})
export class TenantPoolModule {}
