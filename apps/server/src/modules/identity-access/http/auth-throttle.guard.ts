/**
 * Authentication throttle guard (P06.12.01).
 *
 * Token buckets in Postgres (`auth_throttle_buckets` via `app.take_signin_bucket`), keyed by
 * HMAC-SHA256 digest of IP or account id — the guard never stores or logs the raw value
 * (INV-12). Two scopes, separate budgets:
 * - `ip`: every guarded auth-adjacent call costs from the source-address bucket. Public
 *   endpoints (login, callback) have no account yet, so the IP bucket is the only gate.
 * - `account`: post-auth endpoints additionally cost from the verified-subject bucket, so a
 *   distributed source set grinding one account still hits a ceiling.
 *
 * Exceeded budgets answer 429 with `Retry-After` (seconds, from the DEFINER's computed delay)
 * and a coarse problem — never the remaining budget, which is an oracle for bucket state.
 * Every response is `no-store`: a cached 429 would outlive the bucket refill it reports.
 *
 * Client IP: `request.ip` (the socket peer — what Fastify reports without trustProxy, which is
 * unset deliberately: behind ingress, X-Forwarded-For is caller-controlled and must never feed
 * a security decision). Validated to a dotted-quad/colon-hex shape; anything else hashes as a
 * single `invalid` bucket rather than bypassing. Behind the ALB (P05) the WAF rules own
 * edge throttling (EXT-09); this guard is the application layer beneath it.
 *
 * HMAC key: the local token key (`AUTH_LOCAL_TOKEN_KEY`) — a 256-bit secret already in the
 * environment, never in the database (INV-15). Key rotation resets every bucket (digests
 * change), which fails safe: everyone refills from full, nobody bypasses.
 */

import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { LOGGER } from '../../../observability/logger.module.ts';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { AuthThrottleStore } from '../../platform/auth-throttle-store.ts';
import { currentSessionContext } from './current-context.ts';

/** Per-source budget: sustained strangers + burst for legitimate NAT sharing. */
const IP_CAPACITY = 200;
const IP_REFILL_PER_SECOND = 1;
const IP_COST = 1;

/** Per-account budget: tighter — grinding one account from many sources still stops. */
const ACCOUNT_CAPACITY = 50;
const ACCOUNT_REFILL_PER_SECOND = 50 / 60;
const ACCOUNT_COST = 1;

const PROBLEM_TYPE = '/problems/too-many-requests';
const PROBLEM_TITLE = 'Too many requests';

const IP_SHAPE = /^[0-9a-fA-F.:]{3,45}$/;

@Injectable()
export class AuthThrottleGuard implements CanActivate {
  constructor(
    private readonly store: AuthThrottleStore,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const key = this.config.AUTH_LOCAL_TOKEN_KEY;
    if (key === undefined) {
      // No HMAC key in this environment (staging/production until P05.08.01): fail closed
      // rather than throttle on an empty key, which would bucket every source together.
      this.logger.error(
        { route: request.routeOptions.url, reason: 'throttle-key-missing' },
        'auth request without a throttle HMAC key',
      );
      return false;
    }
    const ip = request.ip;
    const shaped = IP_SHAPE.test(ip) ? ip : 'invalid';
    const ipDigest = createHmac('sha256', key).update(`ip:${shaped}`, 'utf8').digest();
    const ipTaken = await this.store.take(
      'ip',
      ipDigest,
      IP_CAPACITY,
      IP_REFILL_PER_SECOND,
      IP_COST,
    );
    if (!ipTaken.allowed) {
      await this.refuse(request, reply, 'ip', ipTaken.retryAfterMs);
      return false;
    }
    // Account bucket only when a verified subject exists on this request: post-auth routes
    // resolve it from the session the guard chain already admitted — never from a body claim.
    const subject = currentSessionContext(request)?.userId;
    if (subject !== undefined) {
      const accountDigest = createHmac('sha256', key).update(`account:${subject}`, 'utf8').digest();
      const accountTaken = await this.store.take(
        'account',
        accountDigest,
        ACCOUNT_CAPACITY,
        ACCOUNT_REFILL_PER_SECOND,
        ACCOUNT_COST,
      );
      if (!accountTaken.allowed) {
        await this.refuse(request, reply, 'account', accountTaken.retryAfterMs);
        return false;
      }
    }
    return true;
  }

  private async refuse(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    retryAfterMs: number,
  ): Promise<void> {
    // Structured security event (P06.12.02, logs now per founder scope — tenant audit lands
    // with deny-new-access): scope + route + retry delay. No IP, no subject, no budget
    // remainder (INV-12).
    this.logger.warn(
      {
        route: request.routeOptions.url,
        method: request.method,
        reason: 'auth_throttled',
        scope,
        retryAfterMs,
      },
      'refused an authentication-adjacent request over budget',
    );
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    void reply.header('cache-control', 'no-store');
    void reply.header('retry-after', String(retryAfterSeconds));
    await reply
      .code(429)
      .header('content-type', 'application/problem+json')
      .send({ type: PROBLEM_TYPE, title: PROBLEM_TITLE, status: 429 });
  }
}
