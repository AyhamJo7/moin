/**
 * Identity and access (P06.06): sign-in and the session primitives.
 *
 * Built at boot, and refuses to build rather than run unsafely: an OIDC callback that does not name
 * this module's route, or an environment without provider-token custody (every deployed one until
 * the KMS key source of P05.08.01 exists), is a `ConfigurationError` and a failed start — never a
 * sign-in that works with the protection missing.
 */

import { Module } from '@nestjs/common';
import { systemClock, type Clock } from '@moin/kernel';
import type { IdentityStore } from '@moin/db';
import type { Logger } from '@moin/observability';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, type Config } from '../../config/env.ts';
import { resolveOidcConfig } from '../../config/oidc.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { IDENTITY_STORE, PlatformDatabaseModule } from '../platform/database.module.ts';
import { SessionService } from './application/session.service.ts';
import { SignInService } from './application/sign-in.service.ts';
import { CALLBACK_PATH } from './domain/session-policy.ts';
import { AuthController } from './http/auth.controller.ts';
import { IDENTITY_CLOCK, SESSIONS, SIGN_IN, type SignInGate } from './identity-access.tokens.ts';
import { OidcProviderClient } from './infrastructure/oidc-provider.ts';
import { resolveTokenCipher } from './infrastructure/token-cipher.ts';

export function buildSignInGate(
  config: Config,
  store: IdentityStore,
  clock: Clock,
  logger: Logger,
): SignInGate {
  if (config.OIDC_PROVIDER === undefined) {
    return { service: undefined };
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
  imports: [PlatformDatabaseModule],
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
      useFactory: (store: IdentityStore, clock: Clock): SessionService =>
        new SessionService(store, clock),
    },
  ],
  exports: [SESSIONS],
})
export class IdentityAccessModule {}
