/**
 * P06.06.01 against the real local provider (ADR-0045): the browser client's own
 * Authorization Code + PKCE flow, end to end.
 *
 * `moin-web` has no direct grants and never gets them back, so this test does what a browser does:
 * the API starts the sign-in, the test follows the redirect to Keycloak's login page, submits its
 * form as the fixture user, and hands the redirect Keycloak answers with to the API's callback.
 * Keycloak itself enforces the S256 challenge, the redirect URI and the single-use code.
 *
 * `moin-tests` is used for one thing only: learning a fixture user's subject, so the `users` row a
 * sign-in needs can exist first — sign-in never creates one. Nothing about the flow under test
 * goes through it.
 *
 * Needs the local stack (`pnpm dev:up`) and TEST_OIDC_ISSUER_URL from the example environment file.
 * This is local Keycloak, not Cognito: it says nothing about the staging pool (P06.05.05).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { OIDC_SCOPES } from '../../config/oidc.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import type { SessionService } from './application/session.service.ts';
import { providerTokensContext } from './application/sign-in.service.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { SESSIONS } from './identity-access.tokens.ts';
import { resolveTokenCipher } from './infrastructure/token-cipher.ts';

const BROWSER_CLIENT = 'moin-web';
const FIXTURE_CLIENT = 'moin-tests';
const REDIRECT_URI = 'http://localhost:3000/api/auth/callback';
const LOCAL_KEY = 'local-v1:local-development-only';
const SESSION_COOKIE_CONTRACT =
  /^__Host-moin_sid=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; HttpOnly; Secure; SameSite=Lax$/;

const realmSchema = z.object({
  clients: z.array(z.looseObject({ clientId: z.string(), secret: z.string().optional() })),
  users: z.array(
    z.looseObject({
      email: z.string(),
      credentials: z.array(z.object({ type: z.string(), value: z.string() })),
    }),
  ),
});

const realm = realmSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../docker/keycloak/realm-moin-local.json'),
      'utf8',
    ),
  ) as unknown,
);

function secretOf(clientId: string): string {
  const secret = realm.clients.find((client) => client.clientId === clientId)?.secret;
  if (secret === undefined) throw new Error(`realm has no secret for ${clientId}`);
  return secret;
}

function issuerUrl(): string {
  const issuer = process.env['TEST_OIDC_ISSUER_URL'];
  if (issuer === undefined || issuer.length === 0) {
    throw new Error(
      'TEST_OIDC_ISSUER_URL is not set. It is in the example environment file, which ' +
        '`pnpm test:integration` reads, and the local stack must be running (`pnpm dev:up`).',
    );
  }
  // Credentials are submitted below; anything but the local fixture would be a credential leak.
  if (!['127.0.0.1', 'localhost'].includes(new URL(issuer).hostname)) {
    throw new Error('TEST_OIDC_ISSUER_URL must point at the local provider on loopback');
  }
  return issuer;
}

let database: TestDatabase;

/** The api's second pool connects as moin_identity, exactly as deployed. */
function identityUrl(): string {
  const url = database.identityUrl;
  if (url === undefined) throw new Error('TEST_DATABASE_IDENTITY_URL is required');
  return url;
}
let admin: ReturnType<TestDatabase['fixturePool']>;
let app: NestFastifyApplication;
const issuer = issuerUrl();

function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The subject Keycloak gives this fixture user, learned through the fixture client. */
async function subjectOf(email: string, password: string): Promise<string> {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: FIXTURE_CLIENT,
      client_secret: secretOf(FIXTURE_CLIENT),
      username: email,
      password,
      scope: OIDC_SCOPES.join(' '),
    }),
  });
  const { id_token: idToken } = z.object({ id_token: z.string() }).parse(await response.json());
  const payload = z
    .object({ sub: z.string() })
    .parse(JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')));
  return payload.sub;
}

/** A minimal cookie jar: what a browser would send back to Keycloak. */
class Jar {
  readonly #cookies = new Map<string, string>();

  take(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair !== undefined && index > 0)
        this.#cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/** Follow the API's redirect to Keycloak, sign in on its form, return Keycloak's redirect back. */
async function authenticateAtProvider(authorizationUrl: string, email: string, password: string) {
  const jar = new Jar();
  const page = await fetch(authorizationUrl, { redirect: 'manual' });
  jar.take(page);
  expect(page.status, 'login page').toBe(200);
  const html = await page.text();
  const action =
    /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1] ??
    /<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"/.exec(html)?.[1];
  if (action === undefined) throw new Error('Keycloak login form not found');
  const submitted = await fetch(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password, credentialId: '' }),
  });
  expect(submitted.status, 'login form').toBe(302);
  const location = new URL(submitted.headers.get('location') ?? '');
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
  return location;
}

async function signIn(email: string, password: string, returnTo = '/today') {
  const started = await app.inject({
    method: 'GET',
    url: `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  });
  expect(started.statusCode).toBe(302);
  const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
    setCookies(started.headers)[0] ?? '',
  )?.[1];
  const authorizationUrl = String(started.headers.location);
  const back = await authenticateAtProvider(authorizationUrl, email, password);
  const callbackUrl = `/api/auth/callback${back.search}`;
  const response = await app.inject({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: `__Host-moin_signin=${binding ?? ''}` },
  });
  return { response, authorizationUrl, callbackUrl, binding, back };
}

beforeAll(async () => {
  database = await createTestDatabase('keycloak');
  admin = database.fixturePool();
  const config = loadConfig({
    NODE_ENV: 'test',
    SERVER_ROLE: 'api',
    DATABASE_URL: database.appUrl,
    OIDC_PROVIDER: 'keycloak',
    OIDC_ISSUER_URL: issuer,
    OIDC_CLIENT_ID: BROWSER_CLIENT,
    OIDC_CLIENT_SECRET: secretOf(BROWSER_CLIENT),
    OIDC_REDIRECT_URI: REDIRECT_URI,
    AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY,
    IDENTITY_DATABASE_URL: identityUrl(),
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(config), LoggerModule, IdentityAccessModule],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('the moin-web Authorization Code + PKCE flow against local Keycloak', () => {
  evidenceTest(
    'signs every fixture user in, server-side, and issues only a session cookie',
    async () => {
      expect(realm.users.length).toBeGreaterThan(0);
      for (const user of realm.users) {
        const password = user.credentials.find((item) => item.type === 'password')?.value;
        if (password === undefined) throw new Error(`fixture user ${user.email} has no password`);

        // Without a user row the person authenticates at Keycloak and is still refused here.
        const stranger = await signIn(user.email, password);
        expect(stranger.response.statusCode, `${user.email} before a user row exists`).toBe(403);

        const id = randomUUID();
        const subject = await subjectOf(user.email, password);
        await admin.query(
          "insert into users (id, cognito_sub, email, status) values ($1, $2, $3, 'active')",
          [id, subject, user.email],
        );

        const { response, authorizationUrl, callbackUrl, binding, back } = await signIn(
          user.email,
          password,
        );
        const request = new URL(authorizationUrl);
        expect(request.searchParams.get('client_id')).toBe(BROWSER_CLIENT);
        expect(request.searchParams.get('code_challenge_method')).toBe('S256');
        expect(back.searchParams.get('iss')).toBe(issuer);

        expect(response.statusCode, user.email).toBe(302);
        expect(response.headers.location).toBe('/today');
        const cookies = setCookies(response.headers);
        const token = SESSION_COOKIE_CONTRACT.exec(cookies[0] ?? '')?.[1];
        expect(token).toBeDefined();
        expect(cookies[1]).toBe(
          '__Host-moin_signin=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
        );

        const resolved = await app.get<SessionService>(SESSIONS).resolve(token);
        expect(resolved?.userId).toBe(id);

        // The provider tokens are at rest only as ciphertext, and they are moin-web's own.
        const row = await admin.query<{ family_id: string; sealed: Buffer; key_id: string }>(
          'select family_id, provider_tokens_sealed as sealed, provider_tokens_key_id as key_id from sessions where user_id = $1',
          [id],
        );
        const stored = row.rows[0];
        const tokens = z.object({ idToken: z.string(), accessToken: z.string() }).parse(
          JSON.parse(
            resolveTokenCipher(
              loadConfig({
                NODE_ENV: 'test',
                SERVER_ROLE: 'api',
                DATABASE_URL: database.appUrl,
                AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY,
              }),
            ).open(
              { keyId: stored?.key_id ?? '', sealed: stored?.sealed ?? Buffer.alloc(0) },
              providerTokensContext(stored?.family_id ?? ''),
            ),
          ),
        );
        const idClaims = JSON.parse(
          Buffer.from(tokens.idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        expect(idClaims['aud']).toBe(BROWSER_CLIENT);
        expect(idClaims['azp']).toBe(BROWSER_CLIENT);
        expect(stored?.sealed.includes(Buffer.from(tokens.idToken))).toBe(false);
        const visible = JSON.stringify(response.headers) + response.body;
        expect(visible).not.toContain(tokens.idToken);
        expect(visible).not.toContain(tokens.accessToken);
        expect(visible).not.toContain(back.searchParams.get('code') ?? '');

        // The same callback again — the state is spent, and Keycloak would refuse the code anyway.
        const replay = await app.inject({
          method: 'GET',
          url: callbackUrl,
          headers: { cookie: `__Host-moin_signin=${binding ?? ''}` },
        });
        expect(replay.statusCode).toBe(400);
      }
    },
  );
});
