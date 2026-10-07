/**
 * Identity and access (P06.06): sign-in and the session primitives.
 *
 * Built at boot, and refuses to build rather than run unsafely: an OIDC callback that does not name
 * this module's route, a missing `moin_identity` pool, or an environment without provider-token
 * custody (every deployed one until the KMS key source of P05.08.01 exists), is a
 * `ConfigurationError` and a failed start — never a sign-in that works with the protection missing.
 *
 * api only. The voice, worker and migrate roots never import this module or the platform database
 * module (`identity-is-api-only` in `.dependency-cruiser.cjs`), and the loader refuses the identity
 * credential for those roles.
 */

import { Module } from '@nestjs/common';
import { systemClock, type Clock } from '@moin/kernel';
import type { IdentityStore } from '@moin/db';
import type { Logger } from '@moin/observability';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, type Config } from '../../config/env.ts';
import { resolveOidcConfig } from '../../config/oidc.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { IDENTITY_STORE, IdentityPoolModule } from '../platform/identity-pool.module.ts';
import { SessionService } from './application/session.service.ts';
import { RequestContextService } from './application/request-context.service.ts';
import { SignInService } from './application/sign-in.service.ts';
import { CALLBACK_PATH } from './domain/session-policy.ts';
import { AuthController } from './http/auth.controller.ts';
import { RequireRoleGuard } from './http/require-role.guard.ts';
import { RequireStepUpGuard } from './http/require-step-up.guard.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
import {
  CONTEXT_CLOCK,
  IDENTITY_CLOCK,
  REQUEST_CONTEXTS,
  SESSIONS,
  SIGN_IN,
  type SignInGate,
} from './identity-access.tokens.ts';
import { OidcProviderClient } from './infrastructure/oidc-provider.ts';
import { resolveTokenCipher } from './infrastructure/token-cipher.ts';

export function buildSignInGate(
  config: Config,
  store: IdentityStore | null,
  clock: Clock,
  logger: Logger,
): SignInGate {
  if (config.OIDC_PROVIDER === undefined) {
    return { service: undefined };
  }
  if (store === null) {
    // The only place the credential is required: the loader deliberately accepts OIDC without it
    // (the P06.05.04 contract is unchanged), so removing this would let sign-in start broken.
    throw new ConfigurationError([
      'IDENTITY_DATABASE_URL: sign-in needs the moin_identity pool and none is configured',
    ]);
  }
  const oidc = resolveOidcConfig(config);
  if (new URL(oidc.redirectUri).pathname !== CALLBACK_PATH) {
    throw new ConfigurationError([
      `OIDC_REDIRECT_URI: must name the callback route ${CALLBACK_PATH}`,
    ]);
  }
  return {
    service: new SignInService({
      config: oidc,
      provider: new OidcProviderClient(oidc),
      cipher: resolveTokenCipher(config),
      store,
      clock,
      logger,
    }),
  };
}

@Module({
  imports: [IdentityPoolModule],
  controllers: [AuthController],
  providers: [
    { provide: IDENTITY_CLOCK, useValue: systemClock },
    {
      provide: SIGN_IN,
      inject: [CONFIG, IDENTITY_STORE, IDENTITY_CLOCK, LOGGER],
      useFactory: buildSignInGate,
    },
    {
      provide: SESSIONS,
      inject: [IDENTITY_STORE, IDENTITY_CLOCK],
      useFactory: (store: IdentityStore | null, clock: Clock): SessionService | null =>
        store === null ? null : new SessionService(store, clock),
    },
    {
      provide: CONTEXT_CLOCK,
      useValue: systemClock,
    },
    {
      provide: REQUEST_CONTEXTS,
      inject: [IDENTITY_STORE, CONTEXT_CLOCK],
      useFactory: (store: IdentityStore | null, clock: Clock): RequestContextService | null =>
        store === null ? null : new RequestContextService(store, clock),
    },
    SessionMembershipGuard,
    RequireRoleGuard,
    RequireStepUpGuard,
    TenantContextInterceptor,
  ],
  exports: [SESSIONS, REQUEST_CONTEXTS],
})
export class IdentityAccessModule {}
