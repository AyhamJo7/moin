/**
 * Owner actions on one task (P13.03.02, M2A): `GET /api/tasks/:id` and `POST /api/tasks/:id/complete`.
 *
 * Guarded like `GET /api/today`: the session + membership gate resolves the organisation from the
 * session cookie (INV-02), every query runs through `withTenant` under FORCE RLS (INV-01), and
 * the per-account throttle applies. The POST is a mutation, so the session gate also demands the
 * CSRF proof (origin + synchronizer token) before this handler runs. Any active member may act
 * on the team's tasks; no capability beyond membership exists for them yet. The route completes
 * any task of the tenant, whatever its type: Heute offers the button on callback cards only
 * (M2A), and a per-type or per-role limit waits for the task capability in the P06.07 matrix.
 *
 * `complete` takes the version the owner saw. It walks the one task state machine (`completeTask`,
 * P07.06) inside one transaction, so a lost race, a stale version or an illegal move is a 409 and
 * changes nothing. A task another tenant owns and a task that does not exist are the same 404
 * (P06.07.03). Answers name the outcome and nothing else (INV-12): no title, number or SQL.
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
import { completeTaskRequestSchema, taskStateSchema, type TaskState } from '@moin/contracts';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { WorkQueries } from '../../platform/work-queries.ts';
import {
  AccountThrottleGuard,
  RequireRoleGuard,
  SessionMembershipGuard,
  TenantContextInterceptor,
} from '../../identity-access/session-guards.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
}

/** A coarse RFC 9457 problem with the real HTTP status. */
function fail(reply: FastifyReply, status: number, type: string, title: string): ProblemBody {
  void reply.code(status).header('content-type', 'application/problem+json');
  return { type, title, status };
}

@Controller('api/tasks')
@UseGuards(SessionMembershipGuard, AccountThrottleGuard, RequireRoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class TasksController {
  constructor(
    private readonly work: WorkQueries,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Get(':id')
  async show(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TaskState | ProblemBody> {
    if (!UUID.test(id)) return fail(reply, 404, '/problems/not-found', 'Not found');
    const task = await this.work.task(id);
    if (task === null) return fail(reply, 404, '/problems/not-found', 'Not found');
    return taskStateSchema.parse({ id: task.id, status: task.status, version: task.version });
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TaskState | ProblemBody> {
    if (!UUID.test(id)) return fail(reply, 404, '/problems/not-found', 'Not found');
    const parsed = completeTaskRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/task-rejected', 'Task change rejected');
    }
    const outcome = await this.work.complete(id, parsed.data.version);
    if (outcome.kind === 'missing') return fail(reply, 404, '/problems/not-found', 'Not found');
    if (outcome.kind === 'conflict') {
      this.logger.info({ outcome: 'task_complete_conflict' }, 'refused a stale task completion');
      return fail(reply, 409, '/problems/version-conflict', 'The task has changed');
    }
    this.logger.info({ outcome: 'task_completed' }, 'completed a task');
    const { task } = outcome;
    return taskStateSchema.parse({ id: task.id, status: task.status, version: task.version });
  }
}
