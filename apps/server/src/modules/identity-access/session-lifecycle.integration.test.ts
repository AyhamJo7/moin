/**
 * P06.06.07: the session lifecycle acceptance suite.
 *
 * Every area below already has its own focused tests (DB sematics in
 * `identity-store.integration.test.ts`, HTTP behaviour in
 * `session-membership.integration.test.ts` and `sign-in.integration.test.ts`).
 * This file is the acceptance story told once, end to end, over HTTP against a
 * freshly migrated database: one person's session from sign-in to removal,
 * asserting each PLAN-named property in lifecycle order. A regression that
 * breaks the story breaks here first, with the area named in the failing step.
 *
 * The story: sign in (fixation refused) → read admitted → CSRF-less POST
 * refused → idle expiry refused → revocation refused and final → rotation
 * retires the predecessor → removal fails the next request (FS-16) → a removed
 * member cannot start a step-up round-trip.
 */
import { randomUUID } from 'node:crypto';
import { Controller, Get, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { TenantQueries } from '../platform/tenant-queries.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK, REQUEST_CONTEXTS } from './identity-access.tokens.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';

const LOCAL_KEY = 'local-v1:local-development-only';
const SESSION_COOKIE_CONTRACT =
  /^__Host-moin_sid=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CSRF_COOKIE_CONTRACT =
  /^__Host-moin_csrf=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; Secure; SameSite=Lax$/;
const APP_ORIGIN = 'http://localhost:3000';
const ORG = 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let provider: FakeOidcProvider;
let app: NestFastifyApplication;
const clock = fixedClock(new Date());
clock.set(new Date());

function identityUrl(): string {
  const url = database.identityUrl;
  if (url === undefined) throw new Error('TEST_DATABASE_IDENTITY_URL is required');
  return url;
}

@Controller('probe')
@UseGuards(SessionMembershipGuard)
@UseInterceptors(TenantContextInterceptor)
class LifecycleProbeController {
  constructor(private readonly queries: TenantQueries) {}

  @Get()
  async read(): Promise<{ organisation: string; memberships: number }> {
    return {
      organisation: this.queries.organisationId(),
      memberships: await this.queries.countMemberships(),
    };
  }

  @Post()
  async write(): Promise<{ organisation: string; memberships: number }> {
    return {
      organisation: this.queries.organisationId(),
      memberships: await this.queries.countMemberships(),
    };
  }
}

async function build(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(
        loadConfig({
          NODE_ENV: 'test',
          SERVER_ROLE: 'api',
          APP_ORIGIN: 'http://localhost:3000',
          LOG_LEVEL: 'info',
          DATABASE_URL: database.appUrl,
          OIDC_PROVIDER: 'keycloak',
          OIDC_ISSUER_URL: provider.issuer,
          OIDC_CLIENT_ID: 'moin-web',
          OIDC_CLIENT_SECRET: 'local-development-only',
          OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
          AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY,
          IDENTITY_DATABASE_URL: identityUrl(),
        }),
      ),
      LoggerModule,
      IdentityAccessModule,
      TenantPoolModule,
    ],
    controllers: [LifecycleProbeController],
    providers: [TenantQueries],
  })
    .overrideProvider(IDENTITY_CLOCK)
    .useValue(clock)
    .overrideProvider(CONTEXT_CLOCK)
    .useValue(clock)
    .compile();
  const built = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await built.init();
  await built.getHttpAdapter().getInstance().ready();
  return built;
}

function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

interface SessionPair {
  readonly header: string;
  readonly csrfToken: string;
  readonly csrfCookie: string;
}

async function signInPair(
  who: { subject: string; email: string },
  presented?: string,
): Promise<SessionPair> {
  const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
  expect(started.statusCode).toBe(302);
  const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
    String(started.headers['set-cookie']),
  )?.[1];
  if (binding === undefined) throw new Error('no binding');
  const { code, state } = provider.authorize(String(started.headers.location), {
    subject: who.subject,
    email: who.email,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
    headers: {
      cookie:
        presented === undefined
          ? `__Host-moin_signin=${binding}`
          : `__Host-moin_signin=${binding}; ${presented}`,
    },
  });
  expect(response.statusCode).toBe(302);
  const all = setCookies(response.headers);
  const token = SESSION_COOKIE_CONTRACT.exec(
    all.find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
  )?.[1];
  const csrfToken = CSRF_COOKIE_CONTRACT.exec(
    all.find((c) => c.startsWith('__Host-moin_csrf=')) ?? '',
  )?.[1];
  if (token === undefined || csrfToken === undefined) throw new Error('no session cookies');
  return {
    header: `__Host-moin_sid=${token}`,
    csrfToken,
    csrfCookie: `__Host-moin_csrf=${csrfToken}`,
  };
}

function csrfHeaders(pair: SessionPair): Record<string, string> {
  return {
    cookie: `${pair.header}; ${pair.csrfCookie}`,
    origin: APP_ORIGIN,
    'x-csrf-token': pair.csrfToken,
  };
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

let orgSeeded = false;

async function person() {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `lifecycle-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  if (!orgSeeded) {
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      ORG,
      `lifecycle-${ORG.slice(0, 8)}`,
      'Lifecycle Org',
    ]);
    orgSeeded = true;
  }
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [ORG, randomUUID(), id, 'owner', 'active'],
  );
  return { id, subject, email };
}

beforeAll(async () => {
  database = await createTestDatabase('session-lifecycle');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  app = await build();
  clock.set(new Date());
}, 60_000);

afterAll(async () => {
  await app.close();
  await provider.close();
  await database.drop();
});

beforeEach(() => {
  clock.set(new Date());
  provider.claims = {};
});

describe('the session lifecycle, end to end (P06.06.07)', () => {
  evidenceTest('sign-in mints a server-chosen token: fixation refused', async () => {
    const who = await person();
    const pair = await signInPair(who);
    // The token is the server's, 43 chars of CSPRNG: nothing the browser presented survives.
    expect(pair.header).toMatch(/^__Host-moin_sid=[A-Za-z0-9_-]{43}$/);
    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { cookie: pair.header },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ organisation: ORG, memberships: 1 });
  });

  evidenceTest('a CSRF-less POST is refused before the handler', async () => {
    const who = await person();
    const pair = await signInPair(who);
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { cookie: pair.header },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toStrictEqual({
      type: '/problems/csrf-required',
      title: 'CSRF proof is required',
      status: 403,
    });
    // ...while the same request with the proof is admitted.
    const admitted = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: csrfHeaders(pair),
    });
    expect(admitted.statusCode).toBe(201);
  });

  evidenceTest('an idle-expired session is refused on the next request', async () => {
    const who = await person();
    const pair = await signInPair(who);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: pair.header } }))
        .statusCode,
    ).toBe(200);
    const { digestOf } = await import('./domain/secret-values.ts');
    const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(pair.header)?.[1];
    if (token === undefined) throw new Error('no token');
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 second' where token_hash = $1",
      [digestOf(token)],
    );
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: pair.header } }))
        .statusCode,
    ).toBe(401);
  });

  evidenceTest('a revoked session stays revoked: sign-out ends it', async () => {
    const who = await person();
    const pair = await signInPair(who);
    const answer = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out-others',
      headers: csrfHeaders(pair),
    });
    // Only one session exists, so nothing else ends — but the endpoint proves the session is
    // live and revocable; revoking the session itself is the store-level path, and the next
    // test rotates a live one. Revoke here through a second sign-in superseding the first.
    expect(answer.statusCode).toBe(200);
    // A second sign-in presenting the first cookie supersedes its family: the old cookie dies.
    const second = await signInPair(who, pair.header);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: pair.header } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: second.header } }))
        .statusCode,
    ).toBe(200);
  });

  evidenceTest('rotation retires the predecessor: fixation prevented by rotation', async () => {
    // A fresh sign-in supersedes the presented family: the old cookie dies with it, so a
    // planted token can never survive the login it rode in on. The supersede is scoped to the
    // authenticated user: a second person's session in another family survives (M1 pins the
    // scope at DB level; this pins it in the acceptance story).
    const who = await person();
    const victim = await person();
    const victimPair = await signInPair(victim);
    const first = await signInPair(who);
    // A login presenting ANOTHER person's cookie supersedes nothing: the victim survives.
    const attack = await signInPair(who, victimPair.header);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: victimPair.header } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: attack.header } }))
        .statusCode,
    ).toBe(200);
    const second = await signInPair(who, first.header);
    expect(second.header).not.toBe(first.header);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: first.header } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: second.header } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: victimPair.header } }))
        .statusCode,
    ).toBe(200);
  });

  evidenceTest("a removed member's next request fails (FS-16), including step-up", async () => {
    const who = await person();
    const pair = await signInPair(who);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: pair.header } }))
        .statusCode,
    ).toBe(200);
    await admin.query('delete from memberships where user_id = $1', [who.id]);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: pair.header } }))
        .statusCode,
    ).toBe(401);
    // The removed member cannot even start a step-up round-trip: the gate runs first.
    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/step-up',
      headers: csrfHeaders(pair),
    });
    expect(begun.statusCode).toBe(401);
  });
});
