/**
 * `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/step-up` and
 * `POST /api/auth/sign-out-others` (P06.06.01/.04/.05).
 *
 * Both are browser navigations, so both answer with a redirect on success and an RFC 9457 problem
 * on failure (ADR-0006). A problem names the coarse outcome and nothing else: whether the `state`
 * was unknown, replayed or from another browser, whether the signature or the nonce was wrong, is
 * logged as a reason code and never told to the caller, who may be the attacker the check exists
 * for. Every response is `no-store`, and the callback sends no referrer, because its own URL held
 * an authorization code.
 *
 * `POST /api/auth/step-up` starts a step-up round-trip for the calling browser's own session
 * (P06.06.04): it 302s to the provider with `max_age=0`, and the callback rotates that session
 * with reason `step_up` when the same person re-verifies. The route is guarded by the session +
 * membership gate — an unauthenticated caller learns nothing beyond the 401.
 */

import { Controller, Get, Headers, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  AUTH_TRANSACTION_TTL_MS,
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
} from '../domain/session-policy.ts';
import { SignInError, type SignInFailure } from '../application/sign-in.service.ts';
import type { SessionService } from '../application/session.service.ts';
import { SESSIONS, SIGN_IN, type SignInGate } from '../identity-access.tokens.ts';
import { clearCookie, readCookie, serializeCookie } from './cookies.ts';
import { SessionMembershipGuard } from './session-membership.guard.ts';

const MS_PER_SECOND = 1000;

interface Problem {
  readonly status: number;
  readonly type: string;
  readonly title: string;
}

/** What a caller learns. Several internal failures share one public answer on purpose. */
const PROBLEMS: Readonly<Record<SignInFailure, Problem>> = {
  unavailable: {
    status: 503,
    type: '/problems/sign-in-unavailable',
    title: 'Sign-in is unavailable',
  },
  return_path_rejected: {
    status: 400,
    type: '/problems/sign-in-rejected',
    title: 'Sign-in request rejected',
  },
  callback_invalid: { status: 400, type: '/problems/sign-in-failed', title: 'Sign-in failed' },
  provider_error: { status: 400, type: '/problems/sign-in-failed', title: 'Sign-in failed' },
  token_invalid: { status: 400, type: '/problems/sign-in-failed', title: 'Sign-in failed' },
  provider_unavailable: {
    status: 502,
    type: '/problems/sign-in-provider-unavailable',
    title: 'Sign-in provider unavailable',
  },
  identity_unavailable: {
    status: 403,
    type: '/problems/sign-in-not-permitted',
    title: 'Sign-in not permitted',
  },
  step_up_invalid: { status: 400, type: '/problems/sign-in-failed', title: 'Sign-in failed' },
};

/** A query value as Fastify parsed it: a repeated key arrives as an array, which we never accept. */
function single(query: Record<string, unknown>, key: string): string | undefined | null {
  const value = query[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(SIGN_IN) private readonly gate: SignInGate,
    @Inject(SESSIONS) private readonly sessions: SessionService | null,
  ) {}

  @Get('login')
  async login(@Query() query: Record<string, unknown>, @Res() reply: FastifyReply): Promise<void> {
    void reply.header('cache-control', 'no-store');
    try {
      const service = this.#service();
      const returnTo = single(query, 'returnTo');
      if (returnTo === null) throw new SignInError('return_path_rejected', 'return_path_repeated');
      const started = await service.start(returnTo);
      await reply
        .code(302)
        .header('location', started.location)
        .header(
          'set-cookie',
          serializeCookie(SIGN_IN_COOKIE, started.binding, AUTH_TRANSACTION_TTL_MS / MS_PER_SECOND),
        )
        .send();
    } catch (error) {
      await this.#problem(reply, error);
    }
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, unknown>,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    void reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    try {
      const service = this.#service();
      const state = single(query, 'state');
      const code = single(query, 'code');
      const error = single(query, 'error');
      const iss = single(query, 'iss');
      if (state === null || code === null || error === null || iss === null) {
        throw new SignInError('callback_invalid', 'parameter_repeated');
      }
      const completed = await service.complete(
        { state, code, error, iss },
        readCookie(cookieHeader, SIGN_IN_COOKIE),
        readCookie(cookieHeader, SESSION_COOKIE),
      );
      await reply
        .code(302)
        .header('location', completed.location)
        .header('set-cookie', [
          serializeCookie(SESSION_COOKIE, completed.sessionToken, completed.cookieMaxAgeSeconds),
          clearCookie(SIGN_IN_COOKIE),
        ])
        .send();
    } catch (error) {
      void reply.header('set-cookie', clearCookie(SIGN_IN_COOKIE));
      await this.#problem(reply, error);
    }
  }

  /**
   * Start a step-up round-trip for the caller's own session. Guarded by the session +
   * membership gate: a removed member's session cannot even start a round-trip. Answers 302
   * to the provider on success, RFC 9457 otherwise — never the session's state.
   */
  @Post('step-up')
  @UseGuards(SessionMembershipGuard)
  async stepUp(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    void reply.header('cache-control', 'no-store');
    try {
      const service = this.#service();
      const started = await service.startStepUp(readCookie(cookieHeader, SESSION_COOKIE));
      await reply
        .code(302)
        .header('location', started.location)
        .header(
          'set-cookie',
          serializeCookie(SIGN_IN_COOKIE, started.binding, AUTH_TRANSACTION_TTL_MS / MS_PER_SECOND),
        )
        .send();
    } catch (error) {
      await this.#problem(reply, error);
    }
  }

  /**
   * "Sign out other devices" (P06.06.05). Ends every other session of the caller's own account and
   * keeps this one. Guarded by the session + membership gate, and the account is the presented
   * session's owner: the request carries no user id. Answers the count and nothing else.
   *
   * The 30 s read cache of P06.06.03 means another device's already-cached GET may be served for
   * up to that long in the process that cached it; mutations on those sessions fail at once.
   */
  @Post('sign-out-others')
  @UseGuards(SessionMembershipGuard)
  async signOutOthers(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    void reply.header('cache-control', 'no-store');
    if (this.sessions === null) {
      await this.#problem(reply, new SignInError('unavailable', 'identity_not_configured'));
      return;
    }
    const revoked = await this.sessions.revokeOthers(readCookie(cookieHeader, SESSION_COOKIE));
    if (revoked === undefined) {
      // Valid a moment ago at the guard, not valid now: the session lapsed or was revoked in
      // between. Same answer as the guard's, naming nothing.
      await reply.code(401).header('content-type', 'application/problem+json').send({
        type: '/problems/unauthenticated',
        title: 'Authentication is required',
        status: 401,
      });
      return;
    }
    await reply.code(200).send({ revoked });
  }

  #service() {
    if (this.gate.service === undefined) {
      throw new SignInError('unavailable', 'oidc_not_configured');
    }
    return this.gate.service;
  }

  async #problem(reply: FastifyReply, error: unknown): Promise<void> {
    if (!(error instanceof SignInError)) {
      // Not ours to describe: Nest's exception layer logs it through the redacting logger and
      // answers with a generic 500.
      throw error;
    }
    const problem = PROBLEMS[error.failure];
    await reply
      .code(problem.status)
      .header('content-type', 'application/problem+json')
      .send({ type: problem.type, title: problem.title, status: problem.status });
  }
}
