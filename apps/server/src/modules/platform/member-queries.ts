/**
 * Member queries for the invitation and lifecycle routes (P06.08, INV-01, INV-02).
 *
 * Lives in `platform/` — the one place allowed to hold the raw tenant pool — so the members
 * controller never imports the pool entry or names the pool type. The organisation id passed to
 * `withTenant` is always the guard-resolved scope's own, never a caller claim; the one
 * exception is the accept flow, which enters the invitation row's own organisation (read from
 * the row the token opened, never from the caller).
 */

import { Inject, Injectable } from '@nestjs/common';
import { type TenantClient, withTenant } from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { randomUUID } from 'node:crypto';
import { currentRequestContext } from '@moin/observability';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../observability/logger.module.ts';
import { requireCapability } from '../identity-access/application/authorization.ts';
import { TENANT_POOL } from './tenant-pool.module.ts';
import { SUPPORT_POOL } from './support-pool.module.ts';
import { currentTenantScope } from './tenant-scope.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id every audit row of this request carries (INV-10, P06.10.03). `audit_events.correlation_id`
 * is a uuid, but an inbound `x-correlation-id` may be any safe token: a caller-supplied value is
 * used when it is a uuid, otherwise the request id (always a uuid, never caller-chosen) — so
 * every row of one request is findable by one id and a malformed header can never fail an audit
 * write.
 */
export function auditCorrelationId(): string | undefined {
  // Tests build the Nest app without bootstrap's onRequest hook, so no request context exists
  // there; production always has one. Fall back to a fresh uuid (never NULL, never caller
  // input) so the audit write cannot fail for lack of correlation anywhere.
  const context = currentRequestContext();
  if (context === undefined) return randomUUID();
  return UUID.test(context.correlationId) ? context.correlationId : context.requestId;
}

@Injectable()
export class MemberQueries {
  constructor(
    @Inject(TENANT_POOL) private readonly dbPool: Pool | null,
    @Inject(SUPPORT_POOL) private readonly supportDbPool: Pool | null,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** The raw pool, for handlers that open their own `withTenant` on the guard scope. */
  tenantPool(): Pool {
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return this.dbPool;
  }

  /** Runs `fn` inside the guard-resolved tenant of the current request. */
  inScope<T>(fn: (client: TenantClient) => Promise<T>): Promise<T> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return withTenant(this.dbPool, scope.organisationId, fn, {
      actorId: scope.actorId,
      correlationId: auditCorrelationId(),
    });
  }

  /**
   * Runs `fn` inside the caller's tenant with the organisation's ownership lock taken FIRST.
   *
   * Every path that can change who owns, or is an active owner of, an organisation (disable,
   * remove, transfer, account disable and enable) goes through here. The last-owner triggers
   * (0017, 0029, 0030) take the same advisory lock after their statement has already locked
   * rows; two transactions that lock rows in opposite order and then queue on that lock
   * deadlock (40P01, G09 M2). Taking the lock before any row lock gives every such path one
   * order: organisation lock, then rows. The key matches the triggers' exactly and the lock is
   * re-entrant for the holder, so the trigger's own call is a no-op.
   */
  inOwnershipScope<T>(fn: (client: TenantClient) => Promise<T>): Promise<T> {
    const scope = currentTenantScope();
    if (scope === undefined) {
      throw new Error('no tenant scope: the route is not guarded by SessionMembershipGuard');
    }
    return this.inScope(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('last-owner:' || $1::text))", [
        scope.organisationId,
      ]);
      return fn(client);
    });
  }

  /** The raw support pool, for grant-gated DEFINER calls (P06.11.03 test + tooling). */
  supportPool(): Pool {
    if (this.supportDbPool === null) {
      throw new Error('no support pool');
    }
    return this.supportDbPool;
  }

  /** Runs `fn` inside the named organisation: the accept flow's invitation row owns it. */
  inOrganisation<T>(organisationId: string, fn: (client: TenantClient) => Promise<T>): Promise<T> {
    if (this.dbPool === null) {
      throw new Error('no tenant pool');
    }
    return withTenant(this.dbPool, organisationId, fn, { correlationId: auditCorrelationId() });
  }

  /** Disable an account with revocation + audit in one commit (P06.09.02, application service).
   *
   * Moved out of RecoveryController (arch-M1): the transaction orchestration lives here so
   * operator workflows arriving later share one checked path instead of duplicating it.
   * Returns 'done' | 'missing' | 'denied' | 'last-owner' | 'conflict'; the controller maps to HTTP shapes. */
  async disableAccount(input: {
    organisationId: string;
    actorId: string;
    targetUserId: string;
    role: string;
    permissions: readonly string[];
    reason: string;
  }): Promise<'done' | 'missing' | 'denied' | 'last-owner' | 'conflict'> {
    return this.inOwnershipScope(async (client) => {
      const target = await client
        .query<{ role: string }>(
          `select m.role from memberships m
             where m.organisation_id = $1::uuid and m.user_id = $2::uuid for update`,
          [input.organisationId, input.targetUserId],
        )
        .then((result) => result.rows[0]);
      if (target === undefined) return 'missing';
      try {
        requireCapability(
          input.role,
          input.permissions,
          target.role === 'owner' ? 'users:manage-owners' : 'users:manage',
        );
      } catch {
        return target.role === 'owner' ? 'missing' : 'denied';
      }
      const settled = await client
        .query<{ changed: boolean; revoked: number }>(
          'select * from app.set_user_status($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid)',
          [input.targetUserId, 'disabled', input.reason, input.actorId, randomUUID()],
        )
        .then((result) => result.rows[0]);
      if (!settled?.changed) return 'missing';
      this.logger.info(
        { outcome: 'account_disabled', revoked: settled.revoked },
        'disabled an account and revoked its sessions',
      );
      return 'done';
    }).catch((error: unknown) => {
      // The users_last_owner backstop (0030) refuses disabling the last effective owner with
      // 23000. Thrown out of the transaction so it rolls back; under a race that is a 409,
      // not a 500 (G09 L1).
      if (isIntegrityViolation(error)) return 'last-owner' as const;
      if (isRetryableConflict(error)) return 'conflict' as const;
      throw error;
    });
  }
}

/** A deadlock victim (40P01) or serialisation failure (40001): the change did not happen. */
export function isRetryableConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const { code } = error as { code: string };
  return code === '40P01' || code === '40001';
}

function isIntegrityViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23000'
  );
}
