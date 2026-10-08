/**
 * The support pool (P06.11.03): `moin_support_ro` connections for grant-gated reads.
 *
 * The one place in `apps/server` allowed to hold a raw `moin_support_ro` pool
 * (`only-platform-opens-transactions` permits `modules/platform`). It derives from
 * `DATABASE_URL` by role swap — same host, same database, support credential — so no new
 * environment variable, no new secret (INV-15). The role holds no table grant on any tenant
 * table: every read goes through a grant-gated DEFINER (gate + read + audit, one commit), and
 * a support connection outside those functions sees nothing.
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import { type Config } from '../../config/env.ts';

export const SUPPORT_POOL = Symbol('SUPPORT_POOL');

const POOL_MAX_CONNECTIONS = 5;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 5_000;

/** Releases the pool on shutdown, so `app.close()` returns with no socket left open. */
@Injectable()
class SupportPoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SUPPORT_POOL) private readonly pool: Pool | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

export function supportConnectionString(appUrl: string): string {
  const url = new URL(appUrl);
  // Same cluster, same database, same credential envelope — only the role name changes. The
  // password travels with DATABASE_URL (local development-only; deployed credentials live in
  // Secrets Manager by ARN, INV-15, with the support ARN alongside the app one in P05), so no
  // new environment variable and no second secret to rotate.
  url.username = 'moin_support_ro';
  return url.toString();
}

export function createSupportPool(config: Config): Pool | null {
  if (config.SERVER_ROLE !== 'api') return null;
  return createPool({
    connectionString: supportConnectionString(config.DATABASE_URL),
    max: POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-support`,
  });
}

@Module({
  providers: [
    {
      provide: SUPPORT_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool | null => createSupportPool(config),
    },
    SupportPoolLifecycle,
  ],
  exports: [SUPPORT_POOL],
})
export class SupportPoolModule {}
