/**
 * Authentication throttle guards (P06.12.01).
 *
 * Two guards, not one, because the subjects resolve at different points in the chain:
 * - `AuthThrottleGuard` (FIRST, before any session work): every guarded auth-adjacent call
 *   costs from the source-address bucket. Mounted before `SessionMembershipGuard` so a
 *   throttled scanner never reaches session resolution — and so 401s for bad sessions still
 *   cost, which is what makes distributed credential-stuffing expensive.
 * - `AccountThrottleGuard` (AFTER `SessionMembershipGuard`): post-auth endpoints additionally
 *   cost from the verified-subject bucket, so a distributed source set grinding one account
 *   still hits a ceiling. Read the subject from `currentSessionContext` — set only on requests
 *   the session guard admitted, never from a body claim. Mounting order matters: before the
 *   session guard the subject is always undefined and the account bucket never runs.
 *
 * Buckets live in Postgres (`auth_throttle_buckets` via `app.take_signin_bucket`), keyed by
 * HMAC-SHA256 digest of IP or account id — the guards never store or log the raw value
 * (INV-12). Two scopes, separate budgets: per-endpoint breakdown would let an attacker rotate
 * endpoints; per-scope buckets make every auth-adjacent call cost from the same budget.
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
    let ipTaken: { allowed: boolean; retryAfterMs: number };
    try {
      ipTaken = await this.store.take('ip', ipDigest, IP_CAPACITY, IP_REFILL_PER_SECOND, IP_COST);
    } catch {
      // No pool (non-api role) or database error: fail closed, like the missing-key branch.
      return false;
    }
    if (!ipTaken.allowed) {
      await this.refuse(request, reply, 'ip', ipTaken.retryAfterMs);
      return false;
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

/**
 * Per-account throttle for post-auth auth-adjacent routes. Mount AFTER `SessionMembershipGuard`:
 * the subject comes from the admitted session, so earlier in the chain there is nothing to
 * throttle on. Fail-closed like the IP guard (no key or pool refuses); a request with no
 * session context (mis-mounted before the session guard) is refused — never silently skipped —
 * so a wiring mistake reads as outage, not as missing protection.
 */
@Injectable()
export class AccountThrottleGuard implements CanActivate {
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
      this.logger.error(
        { route: request.routeOptions.url, reason: 'throttle-key-missing' },
        'auth request without a throttle HMAC key',
      );
      return false;
    }
    const subject = currentSessionContext(request)?.userId;
    if (subject === undefined) {
      // No admitted session on this request: mis-mounted before SessionMembershipGuard, or the
      // session guard let a request through without setting context. Refuse, never skip.
      this.logger.error(
        { route: request.routeOptions.url, reason: 'throttle-no-subject' },
        'account-throttled request without a verified subject',
      );
      return false;
    }
    const digest = createHmac('sha256', key).update(`account:${subject}`, 'utf8').digest();
    let taken: { allowed: boolean; retryAfterMs: number };
    try {
      taken = await this.store.take(
        'account',
        digest,
        ACCOUNT_CAPACITY,
        ACCOUNT_REFILL_PER_SECOND,
        ACCOUNT_COST,
      );
    } catch {
      return false;
    }
    if (!taken.allowed) {
      await this.refuse(request, reply, 'account', taken.retryAfterMs);
      return false;
    }
    return true;
  }

  private async refuse(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    retryAfterMs: number,
  ): Promise<void> {
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
