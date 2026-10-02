/**
 * The provider-neutral OIDC client configuration (P06.05.04).
 *
 * `loadConfig` has already refused every contradictory combination at boot: a provider that does
 * not belong to the environment, a local issuer outside loopback, a Cognito issuer that is not an
 * EU user pool, partial settings. This module turns the validated variables into the one shape
 * the sign-in flow (P06.06.01) consumes, so that code never reads `OIDC_*` variables itself and
 * never branches on which provider is behind them.
 *
 * Server-side only. The client secret is wrapped so it cannot reach a log line, a JSON response
 * or an error by accident, and nothing under `apps/web` may import this file
 * (`web-does-not-import-server-internals`; `oidc.test.ts` checks the browser side for the
 * variables too).
 */

import { inspect } from 'node:util';
import { ConfigurationError, type Config, type OidcProvider } from './env.ts';

/**
 * The scopes that make both providers emit the identity-claims contract (`sub`, `email`,
 * `email_verified`) and nothing that contract does not need. No `profile`, no roles.
 */
export const OIDC_SCOPES = ['openid', 'email'] as const;

const REDACTED = '[redacted]';

/** A credential that only `reveal()` can read; every other way of printing it is redacted. */
export class RedactedSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

export interface OidcClientConfig {
  /** For logs and diagnostics only. Sign-in code must behave identically for every provider. */
  readonly provider: OidcProvider;
  /** Compared exactly against the `iss` claim. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: RedactedSecret;
  readonly redirectUri: string;
  readonly scopes: typeof OIDC_SCOPES;
}

/**
 * The OIDC client this environment signs in with, or a `ConfigurationError` when none is
 * configured. Absence fails closed at the caller that needs sign-in, rather than at every role:
 * the worker and voice processes never authenticate a person.
 */
export function resolveOidcConfig(config: Config): OidcClientConfig {
  const {
    OIDC_PROVIDER: provider,
    OIDC_ISSUER_URL: issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_REDIRECT_URI: redirectUri,
  } = config;
  if (
    provider === undefined ||
    issuer === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    redirectUri === undefined
  ) {
    throw new ConfigurationError(['OIDC_*: sign-in needs an OIDC client and none is configured']);
  }
  return Object.freeze({
    provider,
    issuer,
    clientId,
    clientSecret: new RedactedSecret(clientSecret),
    redirectUri,
    scopes: OIDC_SCOPES,
  });
}
