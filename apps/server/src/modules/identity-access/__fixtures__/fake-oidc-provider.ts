/**
 * A real OIDC provider on loopback, for the sign-in tests (P06.06.01).
 *
 * Not a mock of our client: an HTTP server that behaves like a provider, so the client's real fetch,
 * discovery, key-set and verification paths run unchanged. Its token endpoint enforces what a
 * provider enforces — client authentication, a single-use code bound to its redirect URI, and the
 * PKCE S256 check — so a client that skipped any of them would be refused here as it would be by
 * Keycloak or Cognito. Each test can then bend one thing at a time: the ID token's claims, its
 * signing key or algorithm, or the token endpoint's answer.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload, type CryptoKey } from 'jose';
import type { Clock } from '@moin/kernel';
import { RedactedSecret, type OidcClientConfig } from '../../../config/oidc.ts';

export const FAKE_CLIENT_ID = 'moin-web';
export const FAKE_CLIENT_SECRET = 'local-development-only';
export const FAKE_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';

export interface IssuedFor {
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly subject: string;
  readonly email: string;
}

export interface TokenRequest {
  readonly authorization: string | undefined;
  readonly body: URLSearchParams;
}

type Signing = 'valid' | 'foreign-key' | 'none' | 'hs256';

export interface FakeOidcProvider {
  readonly issuer: string;
  config(): OidcClientConfig;
  /** What the browser does at the authorization endpoint: returns the code and echoed state. */
  authorize(
    authorizationUrl: string,
    person: { subject: string; email: string },
  ): {
    code: string;
    state: string;
  };
  /** Override or add ID-token claims for every token issued from now on (`undefined` deletes). */
  claims: Record<string, unknown>;
  signing: Signing;
  /** Replace the token endpoint's answer entirely. */
  tokenResponse: { status: number; body: string } | undefined;
  /** Replace discovery fields. */
  discovery: Record<string, unknown>;
  readonly tokenRequests: TokenRequest[];
  readonly issued: IssuedFor[];
  /** Every token set the endpoint handed out, so a test can look for it where it must not be. */
  readonly responses: { idToken: string; accessToken: string; refreshToken: string }[];
  close(): Promise<void>;
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export async function startFakeOidcProvider(clock: Clock): Promise<FakeOidcProvider> {
  const signingKeys = await generateKeyPair('RS256');
  const foreignKeys = await generateKeyPair('RS256');
  const kid = randomUUID();
  const publicJwk = { ...(await exportJWK(signingKeys.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, IssuedFor>();

  const basePath = '/realms/fake';
  let issuer = '';
  const state: FakeOidcProvider = {
    get issuer() {
      return issuer;
    },
    config: () => ({
      provider: 'keycloak',
      issuer,
      clientId: FAKE_CLIENT_ID,
      clientSecret: new RedactedSecret(FAKE_CLIENT_SECRET),
      redirectUri: FAKE_REDIRECT_URI,
      scopes: ['openid', 'email'],
    }),
    authorize(authorizationUrl, person) {
      const url = new URL(authorizationUrl);
      const param = (name: string): string => url.searchParams.get(name) ?? '';
      const code = randomBytes(24).toString('base64url');
      const issued: IssuedFor = {
        nonce: param('nonce'),
        codeChallenge: param('code_challenge'),
        codeChallengeMethod: param('code_challenge_method'),
        redirectUri: param('redirect_uri'),
        scope: param('scope'),
        subject: person.subject,
        email: person.email,
      };
      codes.set(code, issued);
      state.issued.push(issued);
      return { code, state: param('state') };
    },
    claims: {},
    signing: 'valid',
    tokenResponse: undefined,
    discovery: {},
    tokenRequests: [],
    issued: [],
    responses: [],
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };

  async function idToken(issued: IssuedFor): Promise<string> {
    const nowSeconds = Math.floor(clock.now().getTime() / 1000);
    const claims: JWTPayload = {
      iss: issuer,
      aud: FAKE_CLIENT_ID,
      sub: issued.subject,
      email: issued.email,
      email_verified: true,
      nonce: issued.nonce,
      // A real provider answering max_age=0 reports when it authenticated the human; tests
      // delete it per-case via `provider.claims = { auth_time: undefined }` to prove refusal.
      auth_time: nowSeconds,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      azp: FAKE_CLIENT_ID,
    };
    for (const [name, value] of Object.entries(state.claims)) {
      if (value === undefined) delete claims[name];
      else claims[name] = value;
    }
    if (state.signing === 'none') {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    }
    if (state.signing === 'hs256') {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256', kid })
        .sign(new TextEncoder().encode(FAKE_CLIENT_SECRET.padEnd(32, '!')));
    }
    const key: CryptoKey =
      state.signing === 'foreign-key' ? foreignKeys.privateKey : signingKeys.privateKey;
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).sign(key);
  }

  const expectedAuthorization = `Basic ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString('base64')}`;

  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', issuer).pathname.slice(basePath.length);
      if (path === '/.well-known/openid-configuration') {
        json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          code_challenge_methods_supported: ['S256'],
          id_token_signing_alg_values_supported: ['RS256'],
          ...state.discovery,
        });
        return;
      }
      if (path === '/jwks') {
        json(response, 200, { keys: [publicJwk] });
        return;
      }
      if (path === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await body(request));
        state.tokenRequests.push({ authorization: request.headers.authorization, body: form });
        if (state.tokenResponse !== undefined) {
          response.writeHead(state.tokenResponse.status, { 'content-type': 'application/json' });
          response.end(state.tokenResponse.body);
          return;
        }
        const code = form.get('code') ?? '';
        const issued = codes.get(code);
        codes.delete(code);
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
        if (
          request.headers.authorization !== expectedAuthorization ||
          form.get('grant_type') !== 'authorization_code' ||
          issued === undefined ||
          form.get('redirect_uri') !== issued.redirectUri ||
          issued.codeChallengeMethod !== 'S256' ||
          verifier.length < 43 ||
          challenge !== issued.codeChallenge
        ) {
          json(response, 400, { error: 'invalid_grant' });
          return;
        }
        const issuedTokens = {
          idToken: await idToken(issued),
          accessToken: `access-${randomBytes(16).toString('hex')}`,
          refreshToken: `refresh-${randomBytes(16).toString('hex')}`,
        };
        state.responses.push(issuedTokens);
        json(response, 200, {
          token_type: 'Bearer',
          access_token: issuedTokens.accessToken,
          refresh_token: issuedTokens.refreshToken,
          expires_in: 300,
          id_token: issuedTokens.idToken,
        });
        return;
      }
      json(response, 404, { error: 'not_found' });
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${basePath}`;
  return state;
}
