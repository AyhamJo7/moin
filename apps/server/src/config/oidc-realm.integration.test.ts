/**
 * P06.05.04: a token the local provider really issues satisfies the identity-claims contract.
 *
 * Signs in through `moin-tests`, the fixture client that keeps direct grants; `moin-web` never
 * gets them back. `oidc-realm.test.ts` pins both clients to the same claim scopes, which is what
 * lets this token stand for the browser client's. The signature is checked against the realm's
 * published keys before any claim is read, so the payload is one Keycloak actually signed.
 *
 * Needs the local stack (`pnpm dev:up`) and TEST_OIDC_ISSUER_URL from the example environment file.
 */
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { evidenceTest } from '@moin/testing';
import { describe, expect } from 'vitest';
import { parseIdentityClaims } from '../modules/identity-access/domain/identity-claims.ts';
import { OIDC_SCOPES } from './oidc.ts';

const FIXTURE_CLIENT = 'moin-tests';

/**
 * Every claim the local ID token may carry: the JWT/OIDC registration and session claims, plus
 * the contract. A `profile`, role, group or custom claim appearing here means the realm drifted.
 */
const PERMITTED_ID_TOKEN_CLAIMS = new Set([
  'iss',
  'sub',
  'aud',
  'exp',
  'iat',
  'auth_time',
  'nonce',
  'acr',
  'azp',
  'at_hash',
  'sid',
  'jti',
  'typ',
  'email',
  'email_verified',
]);

const realmSchema = z.object({
  clients: z.array(z.looseObject({ clientId: z.string(), secret: z.string().optional() })),
  users: z.array(
    z.looseObject({
      email: z.string(),
      credentials: z.array(z.object({ type: z.string(), value: z.string() })),
    }),
  ),
});

const discoverySchema = z.object({
  issuer: z.string(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
const tokenSchema = z.object({ id_token: z.string(), access_token: z.string() });
const headerSchema = z.object({ alg: z.literal('RS256'), kid: z.string() });
const jwksSchema = z.object({
  keys: z.array(z.looseObject({ kid: z.string(), kty: z.string(), use: z.string().optional() })),
});
const payloadSchema = z.looseObject({});

function issuerUrl(): string {
  const issuer = process.env['TEST_OIDC_ISSUER_URL'];
  if (issuer === undefined || issuer.length === 0) {
    throw new Error(
      'TEST_OIDC_ISSUER_URL is not set. It is in the example environment file, which ' +
        '`pnpm test:integration` reads, and the local stack must be running (`pnpm dev:up`).',
    );
  }
  // A password grant against anything but the local fixture would be a credential leak.
  if (!['127.0.0.1', 'localhost'].includes(new URL(issuer).hostname)) {
    throw new Error('TEST_OIDC_ISSUER_URL must point at the local provider on loopback');
  }
  return issuer;
}

const realm = realmSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../docker/keycloak/realm-moin-local.json'),
      'utf8',
    ),
  ) as unknown,
);

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${new URL(url).pathname} answered ${response.status}`,
    );
  }
  return response.json();
}

function decodeSegment(segment: string | undefined): unknown {
  if (segment === undefined) {
    throw new Error('malformed token');
  }
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

/** Verify an RS256 JWT against the realm's published keys and return its payload. */
async function verifiedPayload(token: string, jwksUri: string): Promise<Record<string, unknown>> {
  const [header, payload, signature] = token.split('.');
  const { kid } = headerSchema.parse(decodeSegment(header));
  const { keys } = jwksSchema.parse(await fetchJson(jwksUri));
  const jwk = keys.find((key) => key.kid === kid);
  if (jwk === undefined || signature === undefined) {
    throw new Error('token is not signed by a published realm key');
  }
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url'),
  );
  expect(valid, 'signature').toBe(true);
  return payloadSchema.parse(decodeSegment(payload));
}

async function signIn(email: string, password: string) {
  const issuer = issuerUrl();
  const discovery = discoverySchema.parse(
    await fetchJson(`${issuer}/.well-known/openid-configuration`),
  );
  expect(discovery.issuer).toBe(issuer);
  const secret = realm.clients.find((item) => item.clientId === FIXTURE_CLIENT)?.secret;
  if (secret === undefined) {
    throw new Error(`realm has no secret for ${FIXTURE_CLIENT}`);
  }
  const tokens = tokenSchema.parse(
    await fetchJson(discovery.token_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: FIXTURE_CLIENT,
        client_secret: secret,
        username: email,
        password,
        scope: OIDC_SCOPES.join(' '),
      }),
    }),
  );
  return {
    issuer,
    idToken: await verifiedPayload(tokens.id_token, discovery.jwks_uri),
    accessToken: await verifiedPayload(tokens.access_token, discovery.jwks_uri),
  };
}

describe('a token issued by the local provider', () => {
  evidenceTest('satisfies the identity-claims contract for every fixture user', async () => {
    expect(realm.users.length).toBeGreaterThan(0);
    for (const user of realm.users) {
      const { email } = user;
      const password = user.credentials.find((item) => item.type === 'password')?.value;
      if (password === undefined) {
        throw new Error(`fixture user ${email} has no password`);
      }
      const { issuer, idToken, accessToken } = await signIn(email, password);

      expect(idToken['iss']).toBe(issuer);
      expect(idToken['aud']).toBe(FIXTURE_CLIENT);
      expect(idToken['exp']).toBeGreaterThan(Date.now() / 1000);

      const identity = parseIdentityClaims(idToken);
      expect(identity).toStrictEqual({ subject: idToken['sub'], email });
      expect(identity.subject.length).toBeGreaterThan(0);

      // The same person arriving through Cognito's documented ID-token shape normalises to the
      // same identity, so nothing downstream can tell the providers apart.
      expect(
        parseIdentityClaims({
          sub: identity.subject,
          email: email.toUpperCase(),
          email_verified: true,
          token_use: 'id',
          'cognito:username': identity.subject,
          iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12',
        }),
      ).toStrictEqual(identity);

      const unexpected = Object.keys(idToken).filter(
        (claim) => !PERMITTED_ID_TOKEN_CLAIMS.has(claim),
      );
      expect(unexpected, 'claims outside the contract').toStrictEqual([]);
      for (const claim of ['realm_access', 'resource_access', 'groups', 'roles']) {
        expect(accessToken[claim], `access token ${claim}`).toBeUndefined();
      }
    }
  });
});
