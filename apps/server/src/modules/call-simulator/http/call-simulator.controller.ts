/**
 * `POST /api/dev/simulated-calls` (M1 vertical slice): one completed simulated call in which the
 * caller asked to be called back. Development and test only — the boundary the protocol
 * simulator (P11.16) and the real relay session end replace. Everything behind it is the
 * production path: number route → tenant, then one tenant transaction writing call, outcome
 * and callback task.
 *
 * Order of refusal, each before anything is written:
 *   1. the token guard (404 unconfigured, 401 wrong or missing token);
 *   2. the body schema (400);
 *   3. the dialled number: exactly one active route, else 404 — unknown, quarantined and
 *      ambiguous numbers create nothing in any tenant (fail closed, P11.01);
 *   4. the calling number must be a usable callback number (`classifyCallerId` = present),
 *      else 422: withheld, the business's own and suspicious numbers need the read-back flow;
 *   5. the request must be a callback request, else 422.
 * A repeated CallSid answers 200 with the first delivery's task and writes nothing (INV-11).
 *
 * INV-12: logs carry outcome codes only — never the numbers, the CallSid or the utterance.
 */

import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  simulatedCallResultSchema,
  simulatedCallSchema,
  type SimulatedCallResult,
} from '@moin/contracts';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import type { RouteResolver } from '../../platform/route-resolver.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
import { WorkQueries } from '../../platform/work-queries.ts';
import { classifyCallerId } from '../../voice/application/caller-id.ts';
import { interpretCall } from '../application/callback-request.ts';
import { SimulatorTokenGuard } from './simulator-token.guard.ts';

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
}

function fail(reply: FastifyReply, status: number, type: string, title: string): ProblemBody {
  void reply.code(status).header('content-type', 'application/problem+json');
  return { type, title, status };
}

@Controller('api/dev/simulated-calls')
@UseGuards(SimulatorTokenGuard)
export class CallSimulatorController {
  constructor(
    @Inject(ROUTE_RESOLVER) private readonly routes: RouteResolver,
    private readonly work: WorkQueries,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post()
  @HttpCode(201)
  async simulate(
    @Body() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SimulatedCallResult | ProblemBody> {
    void reply.header('cache-control', 'no-store');
    const parsed = simulatedCallSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(reply, 400, '/problems/simulated-call-rejected', 'Simulated call rejected');
    }
    const call = parsed.data;
    const interpretation = interpretCall(call.utterance);
    if (interpretation.kind === 'invalid') {
      return fail(reply, 400, '/problems/simulated-call-rejected', 'Simulated call rejected');
    }
    const hits = await this.routes.resolve(call.to);
    const route = hits.length === 1 ? hits[0] : undefined;
    if (route === undefined) {
      this.logger.info(
        { route: '/api/dev/simulated-calls', outcome: 'unrouted-number' },
        'refused a simulated call to a number without exactly one active route',
      );
      return fail(reply, 404, '/problems/unrouted-number', 'Number is not routed');
    }
    if (classifyCallerId(call.from, new Set([call.to])) !== 'present') {
      return fail(reply, 422, '/problems/callback-number-unavailable', 'No usable callback number');
    }
    if (interpretation.kind === 'unsupported') {
      return fail(reply, 422, '/problems/unsupported-request', 'Request is not supported');
    }
    const captured = await this.work.captureCallback(route.organisationId, {
      providerCallSid: call.callSid,
      fromNumber: call.from.trim(),
      toNumber: call.to,
      title: interpretation.title,
    });
    if (captured.replayed) void reply.code(200);
    this.logger.info(
      {
        route: '/api/dev/simulated-calls',
        outcome: captured.replayed ? 'callback-replayed' : 'callback-captured',
      },
      'recorded a simulated callback call',
    );
    return simulatedCallResultSchema.parse({
      taskId: captured.taskId,
      replayed: captured.replayed,
    });
  }
}
