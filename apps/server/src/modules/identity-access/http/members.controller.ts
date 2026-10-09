/**
 * Member invitations and membership lifecycle (P06.08, PLAN Authorisation).
 *
 * Guarded by `SessionMembershipGuard` + `RequireRoleGuard` throughout: every route needs an
 * active membership, and the capability it declares. The tenant is the guarded session's own
 * (INV-02) — no route takes an organisation id. Every response is `no-store`, and every
 * refusal answers with a coarse problem that names the outcome and nothing else (INV-12).
 *
 * Routes (all POST, all CSRF-guarded by the session gate):
 * - `invite` (`users:manage`): issue an invitation. Answers 201 with the invitation id, expiry
 *   and — once, here — the raw token for the issuer's out-of-band delivery (P14/EXT-09 SES owns
 *   real sending; the German template is `renderInvitationEmail`).
 * - `invitations/:id/revoke` (`users:manage`): cancel an outstanding invitation. Unknown,
 *   consumed or already-revoked ids share one 404, so the response never confirms whether an
 *   invitation exists (P06.07.03).
 * - `disable` (`users:manage`): disable a membership; their sessions end at once through the
 *   0016 membership trigger. Touching an owner needs `users:manage-owners`.
 * - `remove` (`users:manage` + step-up): delete a membership; the last owner is refused 409 by
 *   the structural backstop (P06.07.04), and their sessions end at once through the trigger.
 * - `transfer-ownership` (`users:manage-owners` + step-up): promote another active member to
 *   owner, then demote self to admin — in that order, so the backstop never fires mid-transfer.
 *
 * Invitation acceptance has NO HTTP route yet. An invitee has no `users` row, and sign-in refuses
 * an unknown subject by design (0012), so there is no session to authenticate the accept call
 * with; the organisation is also unknown until the token is read (INV-02). `acceptInvitation` and
 * `app.accept_invitation` are built and tested at the store layer; the entry path is an open
 * design decision (PROGRESS.md), not something to guess at here.
 */

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
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
import { INVITATION_TTL_DAYS, issueInvitation, revokeInvitation } from '../domain/invitations.ts';
import { RequireStepUpGuard } from './require-step-up.guard.ts';
import { RequireRoleGuard } from './require-role.guard.ts';
import { Require } from './role.ts';
import { AccountThrottleGuard, AuthThrottleGuard } from './auth-throttle.guard.ts';
import { SessionMembershipGuard } from './session-membership.guard.ts';
import { TenantContextInterceptor } from './tenant-context.interceptor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inviteBody = z.object({
  email: z.string().min(3).max(254),
  role: z.string(),
  permissions: z.array(z.string()).optional(),
});

const memberBody = z.object({
  userId: z.string().regex(UUID, 'must be a uuid'),
});

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
}

/** A coarse RFC 9457 problem with the real HTTP status; names the outcome and nothing else. */
function fail(reply: FastifyReply, status: number, type: string, title: string): ProblemBody {
  void reply.code(status).header('content-type', 'application/problem+json');
  return { type, title, status };
}

@Controller('api/members')
@UseGuards(AuthThrottleGuard, SessionMembershipGuard, AccountThrottleGuard, RequireRoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class MembersController {
  constructor(
    private readonly members: MemberQueries,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post('invite')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(201)
  async invite(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = inviteBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/invitation-rejected', 'Invitation rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    // Owners are privileged: inviting one needs the owner capability (matrix, P06.07.01).
    // Unknown invitations and forbidden ones share one 404 (P06.07.03): the response never
    // confirms whether the caller may invite at all, let alone owners.
    let needed: 'users:manage' | 'users:manage-owners';
    try {
      needed = parsed.data.role === 'owner' ? 'users:manage-owners' : 'users:manage';
      requireCapability(scope.role, scope.permissions, needed);
    } catch {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    try {
      // Mutation and audit share one commit (HIGH3): either both land or neither does.
      const issued = await this.members.inScope((client) =>
        issueInvitation(client, {
          organisationId: scope.organisationId,
          email: parsed.data.email,
          role: parsed.data.role,
          permissions: parsed.data.permissions,
          createdBy: scope.actorId,
          audit: (invitationId) =>
            appendAuditEvent(client, {
              source: 'api',
              operation: 'invitation.issue',
              targetKind: 'invitation',
              targetId: invitationId,
              result: 'succeeded',
            }).then(() => undefined),
        }),
      );
      this.logger.info({ outcome: 'invitation_issued' }, 'issued a member invitation');
      return {
        invitationId: issued.invitationId,
        expiresAt: issued.expiresAt.toISOString(),
        expiresInDays: INVITATION_TTL_DAYS,
        token: issued.token,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'InvitationError') {
        return fail(reply, 400, '/problems/invitation-rejected', 'Invitation rejected');
      }
      throw error;
    }
  }

  @Post('invitations/:id/revoke')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async revokeInvite(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!UUID.test(id)) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    const revoked = await this.members.inScope((client) =>
      revokeInvitation(client, id, scope.role, scope.permissions, (done) =>
        done
          ? appendAuditEvent(client, {
              source: 'api',
              operation: 'invitation.revoke',
              targetKind: 'invitation',
              targetId: id,
              result: 'succeeded',
            }).then(() => undefined)
          : Promise.resolve(),
      ),
    );
    if (!revoked) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'invitation_revoked' }, 'revoked a member invitation');
    return { revoked: true };
  }

  @Post('disable')
  @Require('users:manage')
  @HttpCode(200)
  async disable(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = memberBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/member-rejected', 'Member change rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    // One transaction: the target row is locked (FOR UPDATE) before its role is read, the
    // capability is judged against the locked row, and the disable lands in the same commit.
    // A concurrent owner-promotion of the target either commits first (locked row read sees
    // owner, owner capability demanded) or waits on this transaction — never slips between a
    // read and a later write. Unknown targets and forbidden ones share one 404 (P06.07.03).
    const outcome = await this.members
      .inScope(async (client) => {
        const target = await client
          .query<{ role: string }>(
            'select m.role from memberships m where m.user_id = $1::uuid for update',
            [parsed.data.userId],
          )
          .then((result) => result.rows[0]);
        if (target === undefined) return 'missing' as const;
        try {
          requireCapability(
            scope.role,
            scope.permissions,
            target.role === 'owner' ? 'users:manage-owners' : 'users:manage',
          );
        } catch {
          return target.role === 'owner' ? ('missing' as const) : ('denied' as const);
        }
        const updated = await client
          .query<{ n: number }>(
            `update memberships set status = 'disabled', updated_at = clock_timestamp(), version = version + 1
            where user_id = $1::uuid and status = 'active' returning 1 as n`,
            [parsed.data.userId],
          )
          .then((result) => (result.rows[0]?.n ?? 0) === 1);
        if (!updated) return 'missing' as const;
        await appendAuditEvent(client, {
          source: 'api',
          operation: 'member.disable',
          targetKind: 'membership',
          targetId: parsed.data.userId,
          result: 'succeeded',
        });
        return 'disabled' as const;
      })
      .catch((error: unknown) => {
        // Last-owner backstop (P06.07.04): disabling the last active owner fails structurally.
        if (isIntegrityViolation(error)) return 'last-owner' as const;
        throw error;
      });
    if (outcome === 'last-owner') {
      return fail(reply, 409, '/problems/last-owner', 'The last owner cannot be disabled');
    }
    if (outcome !== 'disabled') {
      // Missing, denied on a non-owner (the route guard already answered 403 for the caller's
      // own role), and owner-existence all share one 404: the response never confirms whether
      // an owner membership exists (P06.07.03).
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'member_disabled' }, 'disabled a membership');
    // The 0016 trigger revoked their sessions in the same transaction; the per-request re-check
    // refuses them from the next mutation, with the 30 s GET cache bounding stale reads.
    return { disabled: true };
  }

  @Post('remove')
  @Require('users:manage')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async remove(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = memberBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/member-rejected', 'Member change rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    if (parsed.data.userId === scope.actorId) {
      // Removing yourself is a transfer problem, not a remove: use transfer-ownership.
      return fail(
        reply,
        409,
        '/problems/last-owner',
        'Transfer ownership instead of removing yourself',
      );
    }
    // Same single-transaction shape as disable: lock the target row, judge the capability
    // against the locked row, delete and audit in the same commit. Owner existence stays 404.
    const outcome = await this.members
      .inScope(async (client) => {
        const target = await client
          .query<{ role: string }>(
            'select m.role from memberships m where m.user_id = $1::uuid for update',
            [parsed.data.userId],
          )
          .then((result) => result.rows[0]);
        if (target === undefined) return 'missing' as const;
        try {
          requireCapability(
            scope.role,
            scope.permissions,
            target.role === 'owner' ? 'users:manage-owners' : 'users:manage',
          );
        } catch {
          return target.role === 'owner' ? ('missing' as const) : ('denied' as const);
        }
        const deleted = await client
          .query<{ n: number }>(
            'delete from memberships where user_id = $1::uuid returning 1 as n',
            [parsed.data.userId],
          )
          .then((result) => (result.rows[0]?.n ?? 0) === 1);
        if (!deleted) return 'missing' as const;
        await appendAuditEvent(client, {
          source: 'api',
          operation: 'member.remove',
          targetKind: 'membership',
          targetId: parsed.data.userId,
          result: 'succeeded',
        });
        return 'removed' as const;
      })
      .catch((error: unknown) => {
        if (isIntegrityViolation(error)) return 'last-owner' as const;
        throw error;
      });
    if (outcome === 'last-owner') {
      return fail(reply, 409, '/problems/last-owner', 'The last owner cannot be removed');
    }
    if (outcome !== 'removed') {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'member_removed' }, 'removed a membership');
    return { removed: true };
  }

  @Post('transfer-ownership')
  @Require('users:manage-owners')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async transferOwnership(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = memberBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/member-rejected', 'Member change rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    if (parsed.data.userId === scope.actorId) {
      return fail(reply, 400, '/problems/member-rejected', 'Member change rejected');
    }
    // Promote first, demote self after, in ONE transaction: the last-owner backstop forbids the
    // reverse order, and this order never leaves the organisation without an owner mid-transfer.
    const transferred = await this.members.inScope(async (client) => {
      const promoted = await client
        .query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- membership write through the tenant wrapper; the SET-session rule matches UPDATE ... SET verb text.
          `update memberships set role = 'owner', status = 'active', updated_at = now(), version = version + 1
            where user_id = $1::uuid and status = 'active' returning 1 as n`,
          [parsed.data.userId],
        )
        .then((query) => (query.rows[0]?.n ?? 0) === 1);
      if (!promoted) return false;
      await client.query(
        // eslint-disable-next-line no-restricted-syntax -- membership write through the tenant wrapper; the SET-session rule matches UPDATE ... SET verb text.
        `update memberships set role = 'admin', updated_at = now(), version = version + 1
          where user_id = $1::uuid and role = 'owner'`,
        [scope.actorId],
      );
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'member.transfer_ownership',
        targetKind: 'membership',
        targetId: parsed.data.userId,
        result: 'succeeded',
      });
      return true;
    });
    if (!transferred) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'ownership_transferred' }, 'transferred ownership');
    return { transferred: true };
  }
}

function isIntegrityViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23000'
  );
}
