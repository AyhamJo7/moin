/**
 * The simulated-call entry point's gate (M1 vertical slice).
 *
 * Fails closed in both directions: without `CALL_SIMULATOR_TOKEN` configured (every deployed
 * environment — the configuration loader refuses it there) the route answers exactly the 404 of
 * a route that does not exist; with it configured, only `Authorization: Bearer <token>` passes. The comparison
 * runs over fixed-length SHA-256 digests with `timingSafeEqual`, so neither the token's length
 * nor its prefix leaks through timing. Rejections log a reason code, never the presented value.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';

const BEARER = /^Bearer ([A-Za-z0-9._~-]{1,256})$/;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class SimulatorTokenGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const expected = this.config.CALL_SIMULATOR_TOKEN;
    if (expected === undefined) {
      // The framework's own answer for a route that does not exist, byte for byte, so a scanner
      // cannot tell that this route is mounted at all.
      throw new NotFoundException(`Cannot ${request.method} ${request.url}`);
    }
    void reply.header('cache-control', 'no-store');
    const header = request.headers.authorization;
    const presented = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (presented === undefined || !timingSafeEqual(digest(presented), digest(expected))) {
      this.logger.warn(
        {
          route: request.routeOptions.url,
          reason: presented === undefined ? 'no-token' : 'bad-token',
        },
        'rejected a simulated call without the simulator token',
      );
      await reply.code(401).header('content-type', 'application/problem+json').send({
        type: '/problems/unauthenticated',
        title: 'Authentication is required',
        status: 401,
      });
      return false;
    }
    return true;
  }
}
