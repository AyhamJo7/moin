/**
 * `GET /api/today` (P13.02, M1 vertical slice): the owner's live tasks.
 *
 * Guarded like every tenant route: the session + membership gate resolves the organisation from
 * the session cookie (INV-02), and the handler reads only that organisation's rows through
 * `withTenant` (INV-01). The route takes no id, query or header that could name a tenant. Any
 * active member may read; no capability beyond membership is needed for the team's task list.
 *
 * The per-account throttle applies (after the session guard, keyed by the verified user, never a
 * claim): one session cannot repeat this read without limit. The per-address throttle does not:
 * this read reaches the API from the owner app's server, and behind the load balancer every
 * caller shares one socket address anyway (no trustProxy), so a per-address budget would
 * throttle all tenants together. Edge rate limits are the WAF's (P06.12.01, EXT-09).
 *
 * The response is parsed through the shared contract before it is sent, so the owner app and the
 * API cannot disagree about a task's shape without a test noticing. Task versions are sent only
 * to a caller that announces it understands them (`TODAY_CONTRACT_HEADER`); everyone else gets the
 * original shape, so an older owner app keeps working against this API during a rollout or
 * rollback (M2D-1). Both shapes are the same rows of the same tenant: only `version` differs.
 */

import { Controller, Get, Headers, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  TODAY_CONTRACT_HEADER,
  TODAY_CONTRACT_VERSIONED,
  TODAY_TASK_LIMIT,
  legacyTodayResponseSchema,
  todayResponseSchema,
  type LegacyTodayResponse,
  type TodayResponse,
} from '@moin/contracts';
import { WorkQueries } from '../../platform/work-queries.ts';
import {
  AccountThrottleGuard,
  RequireRoleGuard,
  SessionMembershipGuard,
  TenantContextInterceptor,
} from '../../identity-access/session-guards.ts';

@Controller('api/today')
@UseGuards(SessionMembershipGuard, AccountThrottleGuard, RequireRoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class TodayController {
  constructor(private readonly work: WorkQueries) {}

  @Get()
  async today(
    @Headers(TODAY_CONTRACT_HEADER) contract: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TodayResponse | LegacyTodayResponse> {
    void reply.header('vary', TODAY_CONTRACT_HEADER);
    const { tasks, truncated } = await this.work.today(TODAY_TASK_LIMIT);
    const rows = tasks.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      callerNumber: row.callerNumber,
    }));
    if (contract !== TODAY_CONTRACT_VERSIONED) {
      return legacyTodayResponseSchema.parse({ truncated, tasks: rows });
    }
    return todayResponseSchema.parse({
      truncated,
      tasks: rows.map((row, index) => ({ ...row, version: tasks[index]?.version })),
    });
  }
}
