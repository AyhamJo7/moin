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
 * API cannot disagree about a task's shape without a test noticing.
 */

import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { TODAY_TASK_LIMIT, todayResponseSchema, type TodayResponse } from '@moin/contracts';
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
  async today(): Promise<TodayResponse> {
    const { tasks, truncated } = await this.work.today(TODAY_TASK_LIMIT);
    return todayResponseSchema.parse({
      truncated,
      tasks: tasks.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        priority: row.priority,
        createdAt: row.createdAt.toISOString(),
        version: row.version,
        callerNumber: row.callerNumber,
      })),
    });
  }
}
