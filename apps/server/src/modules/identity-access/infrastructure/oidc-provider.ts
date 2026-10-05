/**
 * The relying-party half of Authorization Code + PKCE, against whichever provider the environment
 * configures (P06.06.01, P06.05.04). Nothing here branches on the provider.
 *
 * ## No home-grown JWT verification
 *
 * Signature, algorithm, issuer, audience, expiry, not-before and token age are checked by `jose`
 * (panva/jose, zero dependencies, MIT): one vetted implementation rather than a few dozen lines of
 * our own that would be subtly wrong in exactly the place it must not be. What remains ours is the
 * OIDC-specific binding `jose` cannot know: the nonce of *this* sign-in, and `azp`.
 *
 * ## No caller-chosen URL
 *
 * Every URL this module fetches is derived from the configured issuer: discovery is
 * `<issuer>/.well-known/openid-configuration`, its `issuer` must equal the configured one exactly,
 * the key set must live on the issuer's own origin, and every endpoint must be HTTPS (or loopback
 * for the local provider). Redirects are never followed. Nothing from a request reaches a fetch.
 *
 * ## Errors carry a kind and a reason code, never a body
 *
 * A provider's error response can quote the code, the client id or worse. It is discarded unread;
 * what survives is a stable reason code that is safe to log (INV-12).
 */

import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { OIDC_SCOPES, type OidcClientConfig } from '../../../config/oidc.ts';
import { digestOf, digestsEqual } from '../domain/secret-values.ts';

/** Both providers sign ID tokens with RS256. `none`, HMAC and everything else is refused. */
export const ID_TOKEN_ALGORITHMS: readonly string[] = ['RS256'];

/** Tolerated clock skew between us and the provider, for `exp` and `nbf`. */
const CLOCK_TOLERANCE_SECONDS = 30;

/** The ID token was issued for the exchange that just happened, so it is never old. */
const MAX_ID_TOKEN_AGE_SECONDS = 600;

/** A provider that does not answer within this is unavailable; the sign-in fails closed. */
const PROVIDER_TIMEOUT_MS = 10_000;

/** A token response is a few kilobytes; anything far larger is not one. */
const MAX_PROVIDER_RESPONSE_BYTES = 65_536;

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export type OidcFailureKind =
  /** The provider could not be reached, timed out, or answered with a server error. */
  | 'provider_unavailable'
  /** The provider refused the exchange: an invalid, reused or foreign code, or a wrong verifier. */
  | 'provider_rejected'
  /** What came back is not a token we accept. */
  | 'token_invalid';

export class OidcError extends Error {
  override readonly name = 'OidcError';

  constructor(
    readonly kind: OidcFailureKind,
    /** A stable, non-sensitive code for logs. Never a value from the token or the response. */
    readonly reason: string,
  ) {
    super(`${kind}: ${reason}`);
  }
}

export interface ProviderTokens {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresInSeconds?: number | undefined;
}

interface ProviderMetadata {
  readonly authorizationEndpoint: URL;
  readonly tokenEndpoint: URL;
  readonly jwksUri: URL;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  id_token_signing_alg_values_supported: z.array(z.string()).optional(),
});

const tokenResponseSchema = z.object({
  token_type: z.string().regex(/^bearer$/i),
  id_token: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
});

/** RFC 6749 §2.3.1: client credentials are form-encoded before they are joined and encoded. */
function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

/** Read at most the limit, aborting as soon as a declared or streamed body exceeds it. */
async function readBounded(response: Response): Promise<string> {
  const tooLarge = new OidcError('token_invalid', 'provider_response_too_large');
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge;
  }
  if (response.body === null) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooLarge;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class OidcProviderClient {
  readonly #config: OidcClientConfig;
  #metadata: Promise<ProviderMetadata> | undefined;
  #keys: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(config: OidcClientConfig) {
    this.#config = config;
  }

  /** The provider's endpoints, discovered once and cached; a failed discovery is retried next time. */
  metadata(): Promise<ProviderMetadata> {
    this.#metadata ??= this.#discover().catch((error: unknown) => {
      this.#metadata = undefined;
      throw error;
    });
    return this.#metadata;
  }

  async authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): Promise<string> {
    const { authorizationEndpoint } = await this.metadata();
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.#config.clientId);
    url.searchParams.set('redirect_uri', this.#config.redirectUri);
    url.searchParams.set('scope', OIDC_SCOPES.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Exchange an authorization code server-side. The client secret never leaves this call. */
  async exchangeCode(code: string, codeVerifier: string): Promise<ProviderTokens> {
    const { tokenEndpoint } = await this.metadata();
    const credentials = Buffer.from(
      `${formEncode(this.#config.clientId)}:${formEncode(this.#config.clientSecret.reveal())}`,
      'utf8',
    ).toString('base64');

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.#config.redirectUri,
          code_verifier: codeVerifier,
        }),
      });
    } catch {
      throw new OidcError('provider_unavailable', 'token_endpoint_unreachable');
    }

    if (response.status >= 500) {
      await response.body?.cancel();
      throw new OidcError('provider_unavailable', 'token_endpoint_failed');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new OidcError('provider_rejected', 'token_request_rejected');
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBounded(response)) as unknown;
    } catch (error) {
      if (error instanceof OidcError) throw error;
      throw new OidcError('token_invalid', 'token_response_malformed');
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new OidcError('token_invalid', 'token_response_malformed');
    }
    return {
      idToken: parsed.data.id_token,
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresInSeconds: parsed.data.expires_in,
    };
  }

  /**
   * Verify an ID token from the exchange and bind it to this sign-in's nonce. Returns the payload
   * for the identity-claims parser, which decides what of it we keep.
   */
  async verifyIdToken(idToken: string, expectedNonceHash: Buffer, now: Date): Promise<JWTPayload> {
    const { jwksUri } = await this.metadata();
    this.#keys ??= createRemoteJWKSet(jwksUri, { timeoutDuration: PROVIDER_TIMEOUT_MS });

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.#keys, {
        issuer: this.#config.issuer,
        audience: this.#config.clientId,
        algorithms: [...ID_TOKEN_ALGORITHMS],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: MAX_ID_TOKEN_AGE_SECONDS,
        currentDate: now,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
      }));
    } catch (error) {
      throw classifyVerificationError(error);
    }

    // OIDC Core §3.1.3.7: with several audiences `azp` must name us; when present it always must.
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const azp = payload['azp'];
    if (
      (azp !== undefined && azp !== this.#config.clientId) ||
      (audiences.length > 1 && azp === undefined)
    ) {
      throw new OidcError('token_invalid', 'authorized_party_mismatch');
    }

    const nonce = payload['nonce'];
    if (typeof nonce !== 'string' || !digestsEqual(digestOf(nonce), expectedNonceHash)) {
      throw new OidcError('token_invalid', 'nonce_mismatch');
    }
    return payload;
  }

  async #discover(): Promise<ProviderMetadata> {
    const issuer = this.#config.issuer;
    const discoveryUrl = new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    let response: Response;
    try {
      response = await fetch(discoveryUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new OidcError('provider_unavailable', 'discovery_unreachable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new OidcError('provider_unavailable', 'discovery_failed');
    }
    let document: z.infer<typeof discoverySchema>;
    try {
      document = discoverySchema.parse(JSON.parse(await readBounded(response)) as unknown);
    } catch {
      throw new OidcError('provider_unavailable', 'discovery_malformed');
    }

    // OIDC Discovery §4.3: the document must name exactly the issuer it was fetched from.
    if (document.issuer !== issuer) {
      throw new OidcError('provider_unavailable', 'discovery_issuer_mismatch');
    }
    if (
      document.code_challenge_methods_supported !== undefined &&
      !document.code_challenge_methods_supported.includes('S256')
    ) {
      throw new OidcError('provider_unavailable', 'discovery_without_pkce_s256');
    }
    if (
      document.id_token_signing_alg_values_supported !== undefined &&
      !ID_TOKEN_ALGORITHMS.some((alg) =>
        document.id_token_signing_alg_values_supported?.includes(alg),
      )
    ) {
      throw new OidcError('provider_unavailable', 'discovery_without_permitted_algorithm');
    }

    const authorizationEndpoint = this.#endpoint(document.authorization_endpoint);
    const tokenEndpoint = this.#endpoint(document.token_endpoint);
    const jwksUri = this.#endpoint(document.jwks_uri);
    if (jwksUri.origin !== new URL(issuer).origin) {
      throw new OidcError('provider_unavailable', 'discovery_foreign_key_set');
    }
    return { authorizationEndpoint, tokenEndpoint, jwksUri };
  }

  #endpoint(raw: string): URL {
    const url = new URL(raw);
    const local = this.#config.provider === 'keycloak';
    const allowed = local
      ? LOOPBACK_HOSTS.includes(url.hostname) &&
        (url.protocol === 'http:' || url.protocol === 'https:')
      : url.protocol === 'https:';
    if (!allowed || url.username !== '' || url.password !== '' || url.hash !== '') {
      throw new OidcError('provider_unavailable', 'discovery_endpoint_not_permitted');
    }
    return url;
  }
}

/** A key-set fetch that fails is the provider's outage; anything else is the token's fault. */
function classifyVerificationError(error: unknown): OidcError {
  if (error instanceof errors.JOSEError) {
    if (
      error.code === 'ERR_JWKS_TIMEOUT' ||
      error.code === 'ERR_JWKS_INVALID' ||
      error.code === 'ERR_JOSE_GENERIC'
    ) {
      return new OidcError('provider_unavailable', 'key_set_unavailable');
    }
    return new OidcError('token_invalid', error.code.toLowerCase());
  }
  return new OidcError('provider_unavailable', 'key_set_unreachable');
}
