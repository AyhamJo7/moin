/**
 * Support access grants (P06.11.02, PLAN Authorisation).
 *
 * Owner/admin-executed, tenant-scoped, inside the guarded session's own organisation (INV-02).
 * Every route is step-up-gated (`support:grant` capability via `@Require`, plus
 * `RequireStepUpGuard`): handing an outsider read access to the tenant is a sensitive action.
 * Grant create + revoke audit in the same commit through the DEFINERs (INV-10). Refusals are
 * coarse (INV-12); unknown grants share one 404 (P06.07.03).
 *
 * What this is NOT:
 * - No operator identity pool exists (P06.11.01 is P05/EXT-09): the operator is an opaque
 *   subject string the owner names (typically the support engineer's provider `sub`), carried
 *   as actor on support reads. No authentication of that subject happens here.
 * - The tenant sees its grants: `GET /api/support/grants` lists live grants of the guarded
 *   organisation (P06.11.02 "visible to the tenant").
 * - Owner notification on grant create/revoke and on emergency access is PENDING (P06.12.02/P14
 *   unwired): recorded as pending in the evidence, never claimed.
 *
 * Routes (POST mutating, all CSRF-guarded by the session gate):
 * - `POST /api/support/grants` (`support:grant` + step-up): create a grant (operator subject,
 *   scope `readonly`, reason 8–500 chars, life 1–72 h). Answers the grant id + expiry.
 * - `POST /api/support/grants/:id/revoke` (`support:grant` + step-up): revoke. Unknown or
 *   already-revoked ids share one 404.
 * - `GET /api/support/grants` (`support:grant`): list live grants of this organisation.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { currentTenantScope } from '../../platform/tenant-scope.ts';
import { MemberQueries } from '../../platform/member-queries.ts';
import { RequireStepUpGuard } from './require-step-up.guard.ts';
import { RequireRoleGuard } from './require-role.guard.ts';
import { Require } from './role.ts';
import { SessionMembershipGuard } from './session-membership.guard.ts';
import { TenantContextInterceptor } from './tenant-context.interceptor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const grantBody = z.object({
  operatorSubject: z.string().min(1).max(255),
  scope: z.literal('readonly'),
  reason: z.string().min(8).max(500),
  hours: z.number().int().min(1).max(72).optional(),
});

function fail(reply: FastifyReply, status: number, type: string, title: string) {
  void reply.code(status).header('content-type', 'application/problem+json');
  return { type, title, status };
}

@Controller('api/support')
@UseGuards(SessionMembershipGuard, RequireRoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class SupportController {
  constructor(
    private readonly members: MemberQueries,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post('grants')
  @Require('support:grant')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(201)
  async createGrant(@Body() raw: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = grantBody.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/support-rejected', 'Support action rejected');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    // One DEFINER call: grant row + audit in the same commit. The organisation is the
    // guard-resolved tenant, never a caller claim (INV-02).
    const created = await this.members.inScope((client) =>
      client
        .query<{ id: string }>(
          'select app.create_support_grant($1::uuid, $2::text, $3::text, $4::text, $5::integer, $6::uuid, $7::uuid) as id',
          [
            scope.organisationId,
            parsed.data.operatorSubject,
            parsed.data.scope,
            parsed.data.reason,
            parsed.data.hours ?? 24,
            scope.actorId,
            randomUUID(),
          ],
        )
        .then((result) => result.rows[0]?.id),
    );
    if (created === undefined) throw new Error('grant creation returned no id');
    this.logger.info({ outcome: 'support_grant_created' }, 'created a support access grant');
    return { grantId: created };
  }

  @Post('grants/:id/revoke')
  @Require('support:grant')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async revokeGrant(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!UUID.test(id)) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    // Scoped revoke: the grant must belong to THIS organisation, else 404 — a grant id from
    // another tenant revokes nothing and reveals nothing (P06.07.03).
    const revoked = await this.members.inScope((client) =>
      client
        .query<{ revoked: boolean }>(
          `select app.revoke_support_grant($1::uuid, $2::uuid, $3::uuid) as revoked
             where exists (select 1 from support_access_grants g
               where g.id = $1::uuid and g.organisation_id = $4::uuid)`,
          [id, scope.actorId, randomUUID(), scope.organisationId],
        )
        .then((result) => result.rows[0]?.revoked ?? false),
    );
    if (!revoked) {
      return fail(reply, 404, '/problems/not-found', 'Not found');
    }
    this.logger.info({ outcome: 'support_grant_revoked' }, 'revoked a support access grant');
    return { revoked: true };
  }

  @Get('grants')
  @Require('support:grant')
  @UseGuards(RequireStepUpGuard)
  @HttpCode(200)
  async listGrants() {
    const scope = currentTenantScope();
    if (scope === undefined) throw new Error('no tenant scope');
    // Live grants only (unrevoked, unexpired by the database clock); no operator secrets —
    // the subject is the opaque identifier the owner named at creation.
    return this.members
      .inScope((client) =>
        client
          .query<{
            id: string;
            operator_subject: string;
            scope: string;
            reason: string;
            expires_at: Date;
            created_at: Date;
          }>(
            `select id, operator_subject, scope, reason, expires_at, created_at
               from support_access_grants
               where organisation_id = $1::uuid and revoked_at is null
                 and expires_at > clock_timestamp() order by created_at desc`,
            [scope.organisationId],
          )
          .then((result) =>
            result.rows.map((row) => ({
              grantId: row.id,
              operatorSubject: row.operator_subject,
              scope: row.scope,
              reason: row.reason,
              expiresAt: row.expires_at.toISOString(),
              createdAt: row.created_at.toISOString(),
            })),
          ),
      )
      .then((grants) => ({ grants }));
  }
}
