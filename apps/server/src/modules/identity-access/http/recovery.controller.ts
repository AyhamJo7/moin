/**
 * Account recovery support actions (P06.09.01, P06.09.02, INV-10).
 *
 * Owner/admin-executed, tenant-scoped, inside the guarded session's own organisation (INV-02).
 * Every route locks its target, acts, revokes, and audits in ONE transaction: a recovery action
 * without its audit row, or an audit row without the action, is a half-state no retry can
 * distinguish. Refusals are coarse (INV-12); owner existence stays 404 (P06.07.03).
 *
 * What this is NOT (honest limits, runbook stop-conditions):
 * - No operator identity exists (P06.11 NOT_STARTED): the actor is the calling owner/admin's own
 *   membership, never an operator. Cross-tenant support work is impossible here by construction.
 * - No deny-new-access mechanism exists: disabling ends live sessions at once (0016 trigger) and
 *   the per-request re-check refuses the next mutation, but a fresh provider sign-in mints a new
 *   session for a still-active user. Containment is therefore PARTIAL — sessions revoked, new
 *   sign-in not denied — and the runbooks record exactly that.
 * - No provider call happens here: password reset is the provider's email flow (Cognito when
 *   P05 provisions it, local Keycloak meanwhile); this side revokes our sessions after the reset
 *   is established, and never resets a password itself.
 * - No recovery-only auth state exists: re-enablement is an explicit owner/admin action below,
 *   audited, after the user re-proves at the provider out of band.
 *
 * Routes (all POST, CSRF-guarded by the session gate):
 * - `disable-user` (`users:manage`): disable the ACCOUNT (`users.status`), revoke every session
 *   of the person (`mfa_reset` / `password_reset`), audit `account.disable`. Stronger than
 *   membership disable: the person cannot sign in anew anywhere while disabled. Touching an
 *   owner needs `users:manage-owners`.
 * - `enable-user` (`users:manage`): re-enable a disabled account, audit `account.enable`. New
 *   sessions mint only after this; revocation is never rolled back.
 * - `revoke-sessions` (`users:manage`): revoke every session of a member without changing
 *   status (suspected-compromise first response), audit `account.revoke_sessions`. Owner
 *   targets need `users:manage-owners`.
 */

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { appendAuditEvent } from '@moin/db';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { currentTenantScope } from '../../platform/tenant-scope.ts';
import { MemberQueries } from '../../platform/member-queries.ts';
import { requireCapability } from '../application/authorization.ts';
import type { SessionService } from '../application/session.service.ts';
import { SESSIONS } from '../identity-access.tokens.ts';
import { RequireStepUpGuard } from './require-step-up.guard.ts';
import { RequireRoleGuard } from './require-role.guard.ts';
import { Require } from './role.ts';
import { SessionMembershipGuard } from './session-membership.guard.ts';
import { TenantContextInterceptor } from './tenant-context.interceptor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const accountBody = z.object({
  userId: z.string().regex(UUID, 'must be a uuid'),
  reason: z.enum(['password_reset', 'mfa_reset']),
});

type Outcome = 'missing' | 'denied' | 'done' | 'last-owner';

function fail(reply: FastifyReply, status: number, type: string, title: string) {
  void reply.code(status).header('content-type', 'application/problem+json');
  return { type, title, status };
}

@Controller('api/recovery')
@UseGuards(SessionMembershipGuard, RequireRoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class RecoveryController {
  constructor(
    private readonly members: MemberQueries,
    @Inject(SESSIONS) private readonly sessions: SessionService | null,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Disable the account and end every session at once (P06.09.02). The `users` row is locked
   * first; the membership role is read from the locked membership row in the same commit, so a
   * concurrent owner-promotion cannot slip between the check and the act (HIGH1 shape).
   */
  @Post('disable-user')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async disableUser(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = accountBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/recovery-rejected', 'Recovery action rejected');
    }
    // The identity pool is required at module load: without it no session can exist, so no
    // recovery action is meaningful. Checked here (not in the transaction) to fail fast.
    if (this.sessions === null) {
      return fail(reply, 503, '/problems/identity-unavailable', 'Identity is unavailable');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    if (parsed.data.userId === scope.actorId) {
      return fail(reply, 409, '/problems/recovery-rejected', 'Recovery action rejected');
    }
    const outcome: Outcome = await this.members.inScope(async (client) => {
      // Capability first, against the locked membership row: the target may belong to this
      // tenant or to none — the role read decides owner-vs-other, and owner-existence stays
      // 404 either way (P06.07.03). No users-table read: moin_app holds no grant on it.
      const target = await client
        .query<{ role: string | null }>(
          `select m.role from memberships m
             where m.user_id = $1::uuid for update`,
          [parsed.data.userId],
        )
        .then((result) => result.rows[0]);
      // No membership here does NOT mean no user: the target may be a member of another
      // tenant (or of none). Fall through to the setter, which returns false without
      // revealing which — the DEFINER touches only the account row, never tenant data.
      if (target !== undefined) {
        try {
          requireCapability(
            scope.role,
            scope.permissions,
            target.role === 'owner' ? 'users:manage-owners' : 'users:manage',
          );
        } catch {
          if (target.role === 'owner') return 'missing';
          return 'denied';
        }
      }
      // One call: status flip + revocation with the reset reason, all inside the setter's
      // transaction — no second connection, no cross-connection wait on the user row.
      const settled = await client
        .query<{ changed: boolean; revoked: number }>(
          'select * from app.set_user_status($1::uuid, $2::text, $3::text)',
          [parsed.data.userId, 'disabled', parsed.data.reason],
        )
        .then((result) => result.rows[0]);
      if (!settled?.changed) return 'missing';
      const revoked = settled.revoked;
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'account.disable',
        targetKind: 'user',
        targetId: parsed.data.userId,
        result: 'succeeded',
      });
      this.logger.info(
        { outcome: 'account_disabled', revoked },
        'disabled an account and revoked its sessions',
      );
      return 'done';
    });
    if (outcome === 'done') return { disabled: true, containment: 'partial' as const };
    // Missing, denied on a non-owner, and owner-existence share one 404 (P06.07.03).
    return fail(reply, 404, '/problems/not-found', 'Not found');
  }

  /**
   * Re-enable a disabled account (P06.09.02 recovery tail). Explicit, audited, step-up-gated:
   * access returns only through this action, never by re-sign-in alone. Revoked sessions stay
   * revoked — new ones mint fresh after this.
   */
  @Post('enable-user')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async enableUser(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = accountBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/recovery-rejected', 'Recovery action rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    const enabled = await this.members.inScope(async (client) => {
      const changed = await client
        .query<{ changed: boolean }>('select app.set_user_status($1::uuid, $2::text) as changed', [
          parsed.data.userId,
          'active',
        ])
        .then((result) => result.rows[0]?.changed ?? false);
      if (!changed) return false;
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'account.enable',
        targetKind: 'user',
        targetId: parsed.data.userId,
        result: 'succeeded',
      });
      return true;
    });
    if (!enabled) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'account_enabled' }, 're-enabled an account');
    return { enabled: true };
  }

  /**
   * Revoke every session of a member without changing status (P06.09.02 first response:
   * suspected compromise, keep the account while killing live access). Audited in the same
   * commit as the revocation call.
   */
  @Post('revoke-sessions')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async revokeSessions(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = accountBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/recovery-rejected', 'Recovery action rejected');
    }
    if (this.sessions === null) {
      return fail(reply, 503, '/problems/identity-unavailable', 'Identity is unavailable');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    const sessions = this.sessions;
    const outcome: Outcome = await this.members.inScope(async (client) => {
      const target = await client
        .query<{ role: string }>(
          'select m.role from memberships m where m.user_id = $1::uuid for update',
          [parsed.data.userId],
        )
        .then((result) => result.rows[0]);
      if (target === undefined) return 'missing';
      try {
        requireCapability(
          scope.role,
          scope.permissions,
          target.role === 'owner' ? 'users:manage-owners' : 'users:manage',
        );
      } catch {
        return target.role === 'owner' ? 'missing' : 'denied';
      }
      const revoked = await sessions.revokeAll(parsed.data.userId, parsed.data.reason);
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'account.revoke_sessions',
        targetKind: 'user',
        targetId: parsed.data.userId,
        result: 'succeeded',
      });
      this.logger.info(
        { outcome: 'sessions_revoked', revoked },
        'revoked every session of a member',
      );
      return 'done';
    });
    if (outcome === 'done') return { revoked: true, containment: 'partial' as const };
    return fail(reply, 404, '/problems/not-found', 'Not found');
  }
}
