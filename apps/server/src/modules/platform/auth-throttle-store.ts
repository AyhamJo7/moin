/**
 * Unscoped auth writes for the throttle guard and the auth controller (P06.12).
 *
 * Lives in `platform/` — the one place allowed to hold the raw tenant pool — so the guard
 * and controller never import the pool entry or name the pool type. Both calls are
 * tenant-free by design: throttles fire before any session exists, and security events
 * record outcomes that have no tenant. The guard computes HMAC digests itself (pure crypto,
 * no pool); this store only executes the two DEFINERs against the digests it is handed.
 */

import { Inject, Injectable } from '@nestjs/common';
import { TENANT_POOL } from './tenant-pool.module.ts';
import type { Pool } from '@moin/db/pool';

@Injectable()
export class AuthThrottleStore {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  /** Refill-then-take one bucket; throws when no pool, so the guard fails closed. */
  async take(
    scope: 'ip' | 'account',
    digest: Buffer,
    capacity: number,
    refillPerSecond: number,
    cost: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    if (this.pool === null) throw new Error('no throttle pool');
    const result = await this.pool.query<{ allowed: boolean; retry_after_ms: number }>(
      'select allowed, retry_after_ms from app.take_signin_bucket($1::text, $2::bytea, $3::double precision, $4::double precision, $5::double precision)',
      [scope, digest, capacity, refillPerSecond, cost],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('throttle function returned no row');
    return { allowed: row.allowed, retryAfterMs: row.retry_after_ms };
  }

  /** Best-effort security event: never throws, never fails the request it reports on. */
  async recordEvent(
    outcome: 'accepted' | 'refused',
    cls: string,
    reason: string,
    digest: Buffer,
    isNewFamily: boolean,
  ): Promise<void> {
    if (this.pool === null) return;
    try {
      await this.pool.query(
        'select app.write_signin_event($1::text, $2::text, $3::text, $4::bytea, $5::boolean)',
        [outcome, cls, reason, digest, isNewFamily],
      );
    } catch {
      // Observability, not control: a failed recording never fails the request.
    }
  }
}
