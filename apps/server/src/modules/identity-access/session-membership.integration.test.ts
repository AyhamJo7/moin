/**
 * P06.06.03: every request re-checks session validity and membership status.
 *
 * HTTP-level, through a real Nest app: a guarded probe controller answers 200 with the resolved
 * organisation, or the guard answers 401. Memberships are seeded through the admin connection;
 * every behaviour under test goes through the guard + DEFINER lookup, exactly as deployed.
 *
 * Cache contract under test: read-only GETs may reuse a resolution for ≤30 s (injected clock);
 * mutations (POST here) always resolve fresh. A disabled or removed member's next request fails
 * (FS-16) with no session sweep, because no request trusts a session without re-reading.
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
const ORG_A = 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb';

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
class ProbeController {
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
    controllers: [ProbeController],
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

async function person(status: 'active' | 'disabled' = 'active') {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `p-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    status,
  ]);
  return { id, subject, email };
}

async function member(userId: string, organisationId: string, role = 'owner', status = 'active') {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [organisationId, randomUUID(), userId, role, status],
  );
}

async function organisation(id: string, slug: string) {
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
}

function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** A signed-in session cookie for a fresh user with one active membership in ORG_A. */
async function signedInCookie(): Promise<string> {
  const who = await person();
  await member(who.id, ORG_A);
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
    headers: { cookie: `__Host-moin_signin=${binding}` },
  });
  expect(response.statusCode).toBe(302);
  const sessionCookie = setCookies(response.headers).find((c) => c.startsWith('__Host-moin_sid='));
  const token = SESSION_COOKIE_CONTRACT.exec(sessionCookie ?? '')?.[1];
  if (token === undefined) throw new Error('no session cookie');
  return `__Host-moin_sid=${token}`;
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('session-membership');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  await organisation(ORG_A, 'alpha');
  await organisation(ORG_B, 'beta');
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

describe('the session + membership gate', () => {
  evidenceTest('rejects a request with no session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toStrictEqual({
      type: '/problems/unauthenticated',
      title: 'Authentication is required',
      status: 401,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  evidenceTest('rejects a malformed cookie without touching the database', async () => {
    const before = contexts().lookups;
    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { cookie: '__Host-moin_sid=not-a-token' },
    });
    expect(response.statusCode).toBe(401);
    expect(contexts().lookups).toBe(before);
  });

  evidenceTest('admits a signed-in member and resolves their organisation', async () => {
    const cookie = await signedInCookie();
    const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
    if (token === undefined) throw new Error('no token');
    const { digestOf } = await import('./domain/secret-values.ts');
    const parts = await admin.query(
      'select s.id, s.revoked_at, s.idle_expires_at > clock_timestamp() as idle_ok, s.absolute_expires_at > clock_timestamp() as abs_ok, u.status as ustatus, clock_timestamp() as dbnow from sessions s join users u on u.id = s.user_id where s.token_hash = $1',
      [digestOf(token)],
    );
    const mparts = await admin.query('select organisation_id, role, status from memberships');
    expect(
      parts.rowCount,
      `session=${JSON.stringify(parts.rows)} memberships=${JSON.stringify(mparts.rows)}`,
    ).toBe(1);
    const response = await app.inject({ method: 'GET', url: '/probe', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ organisation: ORG_A, memberships: 1 });
  });

  evidenceTest('rejects an expired session on the next request', async () => {
    const cookie = await signedInCookie();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
    if (token === undefined) throw new Error('no token');
    const { digestOf } = await import('./domain/secret-values.ts');
    const digest = digestOf(token);
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 second' where token_hash = $1",
      [digest],
    );
    contexts().clearCache();
    const response = await app.inject({ method: 'GET', url: '/probe', headers: { cookie } });
    expect(response.statusCode).toBe(401);
  });

  evidenceTest('a disabled member fails the next request (FS-16)', async () => {
    const who = await person();
    await member(who.id, ORG_A);
    const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(started.headers['set-cookie']),
    )?.[1];
    if (binding === undefined) throw new Error('no binding');
    const { code, state } = provider.authorize(String(started.headers.location), {
      subject: who.subject,
      email: who.email,
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${binding}` },
    });
    const token = SESSION_COOKIE_CONTRACT.exec(
      setCookies(callback.headers).find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
    )?.[1];
    if (token === undefined) throw new Error('no session cookie');
    const cookie = `__Host-moin_sid=${token}`;
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    await admin.query("update users set status = 'disabled' where id = $1", [who.id]);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  evidenceTest('a removed member fails the next request (FS-16)', async () => {
    const who = await person();
    await member(who.id, ORG_A);
    const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(started.headers['set-cookie']),
    )?.[1];
    if (binding === undefined) throw new Error('no binding');
    const { code, state } = provider.authorize(String(started.headers.location), {
      subject: who.subject,
      email: who.email,
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${binding}` },
    });
    const token = SESSION_COOKIE_CONTRACT.exec(
      setCookies(callback.headers).find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
    )?.[1];
    if (token === undefined) throw new Error('no session cookie');
    const cookie = `__Host-moin_sid=${token}`;
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    await admin.query('delete from memberships where user_id = $1', [who.id]);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  evidenceTest('a member of two organisations gets 401, never a guess (fail closed)', async () => {
    const who = await person();
    await member(who.id, ORG_A);
    await member(who.id, ORG_B);
    const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(started.headers['set-cookie']),
    )?.[1];
    if (binding === undefined) throw new Error('no binding');
    const { code, state } = provider.authorize(String(started.headers.location), {
      subject: who.subject,
      email: who.email,
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${binding}` },
    });
    const token = SESSION_COOKIE_CONTRACT.exec(
      setCookies(callback.headers).find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
    )?.[1];
    if (token === undefined) throw new Error('no session cookie');
    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { cookie: `__Host-moin_sid=${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  evidenceTest('GET reuses a resolution within 30 s, mutations always resolve fresh', async () => {
    const cookie = await signedInCookie();
    contexts().clearCache();
    const before = contexts().lookups;
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    expect(contexts().lookups).toBe(before + 1);
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    expect(contexts().lookups).toBe(before + 1);
    expect(
      (await app.inject({ method: 'POST', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(201);
    expect(contexts().lookups).toBe(before + 2);
    expect(
      (await app.inject({ method: 'POST', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(201);
    expect(contexts().lookups).toBe(before + 3);
  });

  evidenceTest('a cached GET expires after 30 s on the injected clock', async () => {
    const cookie = await signedInCookie();
    contexts().clearCache();
    const before = contexts().lookups;
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
    expect(contexts().lookups).toBe(before + 1);
    clock.advance(31_000);
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
      ).toBe(200);
      expect(contexts().lookups).toBe(before + 2);
    } finally {
      clock.set(new Date());
    }
  });
});
