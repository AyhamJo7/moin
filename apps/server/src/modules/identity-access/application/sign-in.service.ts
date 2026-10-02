/**
 * Sign-in: Authorization Code + PKCE, handled entirely server-side (P06.06.01, ADR-0005).
 *
 * ## The sequence, and what each step protects
 *
 * `start` draws four independent 256-bit values — `state`, nonce, PKCE verifier and a browser
 * binding — and stores a pending sign-in holding their digests and the sealed verifier. The browser
 * receives the binding in a `__Host-` cookie and is sent to the provider with `state`, nonce and
 * the S256 challenge. The verifier itself never leaves the server.
 *
 * `complete` consumes the pending sign-in **before** anything else: by `state`, from the browser
 * holding the binding, unexpired, exactly once (migration 0012). Only then does it exchange the
 * code — server-side, with the client secret and the verifier — verify the ID token, check its
 * nonce against this sign-in, reduce it to the canonical identity (subject and verified email; no
 * tenant or role claim survives), seal the provider tokens and issue the application session. If any
 * step fails, the pending sign-in is already gone: a retry is a fresh sign-in, never a replay.
 *
 * ## What the browser ends up holding
 *
 * One opaque 256-bit session token in an HttpOnly cookie. No provider token, no ID token, no code,
 * no subject, email, tenant or role. Where the session goes after sign-in is a path we stored
 * ourselves at `start`, validated then.
 *
 * ## Authentication is not authorisation
 *
 * A session identifies a person who has an active `users` row; sign-in creates no such row and
 * grants nothing in any organisation. Membership is checked on every request (P06.06.03), from our
 * tables, never from a claim.
 */

import { uuidv7, type Clock } from '@moin/kernel';
import type { IdentityStore } from '@moin/db';
import type { Logger } from '@moin/observability';
import type { OidcClientConfig } from '../../../config/oidc.ts';
import { IdentityClaimsError, parseIdentityClaims } from '../domain/identity-claims.ts';
import { DEFAULT_RETURN_PATH } from '../domain/session-policy.ts';
import { safeReturnPath } from '../domain/return-path.ts';
import { OidcError, type OidcProviderClient } from '../infrastructure/oidc-provider.ts';
import { digestOf, isSecretValue, pkceChallenge, randomSecret } from '../domain/secret-values.ts';
import { SealedValueError, type TokenCipher } from '../infrastructure/token-cipher.ts';

/** Bound on the authorization code we will forward; both providers issue far shorter ones. */
const MAX_CODE_LENGTH = 2048;
const CODE_PATTERN = /^[\x21-\x7e]+$/;
const MS_PER_SECOND = 1000;

export type SignInFailure =
  /** No OIDC client or no token custody in this environment. */
  | 'unavailable'
  /** The return path asked for at start is not an internal path. */
  | 'return_path_rejected'
  /** Missing, unknown, expired, replayed or foreign-browser callback; malformed parameters. */
  | 'callback_invalid'
  /** The provider redirected back with an error (cancelled, denied, failed MFA). */
  | 'provider_error'
  /** Discovery, keys or the token endpoint could not be reached or failed. */
  | 'provider_unavailable'
  /** The exchange was refused, or what came back is not a token we accept. */
  | 'token_invalid'
  /** The person authenticated but has no active user here. Sign-in never creates one. */
  | 'identity_unavailable';

export class SignInError extends Error {
  override readonly name = 'SignInError';

  constructor(
    readonly failure: SignInFailure,
    /** Stable, non-sensitive; for logs only. The browser sees the failure's public problem. */
    readonly reason: string,
  ) {
    super(`${failure}: ${reason}`);
  }
}

export interface StartedSignIn {
  /** The provider's authorization URL. */
  readonly location: string;
  /** Goes into the sign-in binding cookie, and nowhere else. */
  readonly binding: string;
}

export interface CallbackParameters {
  readonly state?: string | undefined;
  readonly code?: string | undefined;
  readonly error?: string | undefined;
  readonly iss?: string | undefined;
}

export interface CompletedSignIn {
  /** An internal path, validated when the sign-in started. */
  readonly location: string;
  /** The raw session token: for the cookie, and nowhere else. */
  readonly sessionToken: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly absoluteExpiresAt: Date;
  /** Seconds until the absolute expiry: the session cookie never outlives the session. */
  readonly cookieMaxAgeSeconds: number;
}

export interface SignInDependencies {
  readonly config: OidcClientConfig;
  readonly provider: OidcProviderClient;
  readonly cipher: TokenCipher;
  readonly store: IdentityStore;
  readonly clock: Clock;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
}

/** Associated data: a sealed verifier opens only for the sign-in it was sealed for. */
export function verifierContext(stateHash: Buffer): string {
  return `moin/pkce-verifier/v1:${stateHash.toString('hex')}`;
}

/** Associated data: provider tokens open only for the session family they were sealed for. */
export function providerTokensContext(familyId: string): string {
  return `moin/provider-tokens/v1:${familyId}`;
}

export class SignInService {
  readonly #deps: SignInDependencies;

  constructor(deps: SignInDependencies) {
    this.#deps = deps;
  }

  async start(returnTo: string | undefined): Promise<StartedSignIn> {
    const { provider, cipher, store, clock } = this.#deps;
    const target = returnTo === undefined ? DEFAULT_RETURN_PATH : safeReturnPath(returnTo);
    if (target === undefined) {
      throw this.#fail('return_path_rejected', 'return_path_not_internal');
    }

    const state = randomSecret();
    const nonce = randomSecret();
    const verifier = randomSecret();
    const binding = randomSecret();
    const stateHash = digestOf(state);

    let location: string;
    try {
      // Discovery first: if the provider is down, nothing is written and nothing is half-started.
      location = await provider.authorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
      });
    } catch (error) {
      throw this.#fromProvider(error);
    }

    const sealedVerifier = cipher.seal(verifier, verifierContext(stateHash));
    await store.beginAuthTransaction({
      stateHash,
      bindingHash: digestOf(binding),
      nonceHash: digestOf(nonce),
      verifierSealed: sealedVerifier.sealed,
      keyId: sealedVerifier.keyId,
      returnTo: target,
      now: clock.now(),
    });
    this.#deps.logger.info(
      { outcome: 'sign-in started', provider: this.#deps.config.provider },
      'sign-in started',
    );
    return { location, binding };
  }

  /**
   * `binding` is the sign-in cookie's value; `presentedSession` the session cookie's, if the
   * browser already had one. Neither is trusted: each is only ever hashed and compared.
   */
  async complete(
    parameters: CallbackParameters,
    binding: string | undefined,
    presentedSession: string | undefined,
  ): Promise<CompletedSignIn> {
    const { config, provider, cipher, store, clock } = this.#deps;
    const { state } = parameters;
    if (!isSecretValue(state)) {
      throw this.#fail('callback_invalid', 'state_missing_or_malformed');
    }

    // Consumed first, whatever follows: from here on this `state` can never be used again. A
    // browser without the binding cookie still burns it — with a digest that matches nothing — so
    // presenting a `state` anywhere, from any browser, is the end of that sign-in.
    const stateHash = digestOf(state);
    const pending = await store.consumeAuthTransaction(
      stateHash,
      digestOf(isSecretValue(binding) ? binding : randomSecret()),
      clock.now(),
    );

    if (parameters.error !== undefined) {
      throw this.#fail('provider_error', 'provider_returned_error');
    }
    if (pending === undefined) {
      throw this.#fail('callback_invalid', 'transaction_unknown_expired_or_foreign');
    }
    // RFC 9207: when the provider names itself, it must be the one we sent the person to.
    if (parameters.iss !== undefined && parameters.iss !== config.issuer) {
      throw this.#fail('callback_invalid', 'issuer_parameter_mismatch');
    }
    const { code } = parameters;
    if (code === undefined || code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) {
      throw this.#fail('callback_invalid', 'code_missing_or_malformed');
    }

    let verifier: string;
    try {
      verifier = cipher.open(
        { keyId: pending.keyId, sealed: pending.verifierSealed },
        verifierContext(stateHash),
      );
    } catch (error) {
      if (error instanceof SealedValueError) {
        throw this.#fail('callback_invalid', 'verifier_does_not_open');
      }
      throw error;
    }

    let identity: ReturnType<typeof parseIdentityClaims>;
    let tokens: Awaited<ReturnType<OidcProviderClient['exchangeCode']>>;
    try {
      tokens = await provider.exchangeCode(code, verifier);
      const payload = await provider.verifyIdToken(tokens.idToken, pending.nonceHash, clock.now());
      identity = parseIdentityClaims(payload);
    } catch (error) {
      if (error instanceof IdentityClaimsError) {
        throw this.#fail('token_invalid', 'identity_claims_rejected');
      }
      throw this.#fromProvider(error);
    }

    const now = clock.now();
    const sessionToken = randomSecret();
    // One reading of the clock per operation, so the session id's timestamp is its creation time.
    const sessionId = uuidv7({ now: () => now });
    const sealedTokens = cipher.seal(
      JSON.stringify({
        v: 1,
        idToken: tokens.idToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt:
          tokens.expiresInSeconds === undefined
            ? undefined
            : new Date(now.getTime() + tokens.expiresInSeconds * MS_PER_SECOND).toISOString(),
      }),
      providerTokensContext(sessionId),
    );

    const granted = await store.beginSession({
      subject: identity.subject,
      tokenHash: digestOf(sessionToken),
      sessionId,
      providerTokensSealed: sealedTokens.sealed,
      keyId: sealedTokens.keyId,
      replacedHash: isSecretValue(presentedSession) ? digestOf(presentedSession) : undefined,
      now,
    });
    if (granted === undefined) {
      throw this.#fail('identity_unavailable', 'no_active_user_for_subject');
    }

    this.#deps.logger.info(
      {
        outcome: 'signed in',
        provider: config.provider,
        sessionId: granted.sessionId,
        userId: granted.userId,
      },
      'signed in',
    );
    return {
      location: pending.returnTo,
      sessionToken,
      sessionId: granted.sessionId,
      userId: granted.userId,
      absoluteExpiresAt: granted.absoluteExpiresAt,
      cookieMaxAgeSeconds: Math.max(
        1,
        Math.floor((granted.absoluteExpiresAt.getTime() - now.getTime()) / MS_PER_SECOND),
      ),
    };
  }

  #fromProvider(error: unknown): SignInError {
    if (error instanceof OidcError) {
      return this.#fail(
        error.kind === 'provider_unavailable' ? 'provider_unavailable' : 'token_invalid',
        error.reason,
      );
    }
    throw error;
  }

  #fail(failure: SignInFailure, reason: string): SignInError {
    this.#deps.logger.warn(
      {
        outcome: 'sign-in refused',
        reason: `${failure}:${reason}`,
        provider: this.#deps.config.provider,
      },
      'sign-in refused',
    );
    return new SignInError(failure, reason);
  }
}
