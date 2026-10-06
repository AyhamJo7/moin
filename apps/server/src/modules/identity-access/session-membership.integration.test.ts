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
import { RequireStepUpGuard } from './http/require-step-up.guard.ts';
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

  @Get('boom')
  boom(): never {
    throw new Error('probe failure');
  }

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

  @Get('sensitive')
  @UseGuards(RequireStepUpGuard)
  sensitive(): { steppedUp: true } {
    return { steppedUp: true };
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
  return signedInCookieAs(who);
}

/** The same round-trip for a given person (wrong-subject tests sign in as someone else). */
async function signedInCookieAs(who: { subject: string; email: string }): Promise<string> {
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

  evidenceTest('guarded error responses carry private no-store', async () => {
    const cookie = await signedInCookie();
    const response = await app.inject({ method: 'GET', url: '/probe/boom', headers: { cookie } });
    expect(response.statusCode).toBe(500);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  evidenceTest('admits a signed-in member and resolves their organisation', async () => {
    const cookie = await signedInCookie();
    const response = await app.inject({ method: 'GET', url: '/probe', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body: { organisation: string; memberships: number } = response.json();
    expect(body.organisation).toBe(ORG_A);
    expect(body.memberships).toBeGreaterThanOrEqual(1);
    // Guarded 200s are tenant-resolved from a cookie-authenticated request: no shared cache may
    // store them (M1 hardening).
    expect(response.headers['cache-control']).toBe('private, no-store');
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

describe('the step-up gate (P06.06.04)', () => {
  evidenceTest('a fresh sign-in passes step-up (login is MFA)', async () => {
    const cookie = await signedInCookie();
    const response = await app.inject({
      method: 'GET',
      url: '/probe/sensitive',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ steppedUp: true });
  });

  evidenceTest(
    'old provider authentication must not grant a fresh sensitive-action window',
    async () => {
      // Defect 1: a plain login whose ID token carries a stale auth_time (existing IdP
      // session, no fresh human proof) begins un-stepped-up: the sensitive gate 403s.
      provider.claims = { auth_time: Math.floor(Date.now() / 1000) - 3600 };
      try {
        const cookie = await signedInCookie();
        contexts().clearCache();
        const result = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(result.statusCode).toBe(403);
      } finally {
        provider.claims = {};
      }
    },
  );

  evidenceTest(
    'cached freshness must not outlive the DB deadline with an application clock behind',
    async () => {
      // Defect 2: constant app↔DB skew must not stretch the verdict. The stamp is ~2 s from
      // lapsing on the DB clock while the app clock runs 5 minutes behind: the first read
      // caches a fresh verdict with a ~2 s budget, and the second read — past the budget in
      // local elapsed time — flips stepUpFresh without any new database lookup.
      const cookie = await signedInCookie();
      const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
      if (token === undefined) throw new Error('no token');
      const { digestOf } = await import('./domain/secret-values.ts');
      await admin.query(
        "update sessions set step_up_at = clock_timestamp() - interval '15 minutes' + interval '2 seconds' where token_hash = $1",
        [digestOf(token)],
      );
      // Stand-in for a behind clock: wind the injected clock back 5 minutes. The sign-in
      // above ran on the real reading, so the DB stamp is fixed in database time; the guard
      // clock is the only one that runs behind. Note the fake provider shares this clock,
      // but no provider flow runs below — only reads — so issued-token times are unaffected.
      clock.set(new Date(clock.now().getTime() - 300_000));
      try {
        contexts().clearCache();
        const first = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(first.statusCode).toBe(200);
        const lookups = contexts().lookups;
        await admin.query('select pg_sleep(2.5)');
        clock.advance(2500);
        const truth = await admin.query<{ fresh: boolean }>(
          "select step_up_at > clock_timestamp() - interval '15 minutes' as fresh from sessions where token_hash = $1",
          [digestOf(token)],
        );
        expect(truth.rows[0]?.fresh).toBe(false);
        const second = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(contexts().lookups).toBe(lookups);
        expect(second.statusCode).toBe(403);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'provider proof auth_time near window boundary retains only its remaining lifetime',
    async () => {
      // An IdP proof with auth_time = now - 898s (2s left of the 15-minute window)
      // preserves its true proof age (step_up_at = auth_time), not a new 15-minute window.
      // At creation it passes the sensitive gate; after 2.5s it lapses and 403s.
      provider.claims = { auth_time: Math.floor(Date.now() / 1000) - 898 };
      try {
        const cookie = await signedInCookie();
        const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
        if (token === undefined) throw new Error('no token');

        contexts().clearCache();
        const first = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(first.statusCode).toBe(200);

        // Sleep 2.5s to cross the remaining 2s lifetime
        await admin.query('select pg_sleep(2.5)');
        clock.advance(2500);

        contexts().clearCache();
        const second = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(second.statusCode).toBe(403);
      } finally {
        provider.claims = {};
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'cache rollback protection: wall-clock rollback cannot revive expired cached verdict',
    async () => {
      // Once the step-up budget expires, the cached verdict stays stale. A subsequent
      // wall-clock rollback cannot revive it.
      const cookie = await signedInCookie();
      const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
      if (token === undefined) throw new Error('no token');
      const { digestOf } = await import('./domain/secret-values.ts');

      await admin.query(
        "update sessions set step_up_at = clock_timestamp() - interval '15 minutes' + interval '2 seconds' where token_hash = $1",
        [digestOf(token)],
      );

      const initialClock = new Date();
      clock.set(initialClock);
      try {
        contexts().clearCache();

        // First read caches entry with ~2s budget
        const first = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(first.statusCode).toBe(200);

        // Advance clock and DB past the budget
        await admin.query('select pg_sleep(2.5)');
        clock.advance(2500);

        // Second read sees budget expired, evicts entry permanently and returns 403
        const second = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(second.statusCode).toBe(403);

        // Roll clock back to initial reading: entry was deleted, cannot revive fresh verdict
        clock.set(initialClock);
        const third = await app.inject({
          method: 'GET',
          url: '/probe/sensitive',
          headers: { cookie },
        });
        expect(third.statusCode).toBe(403);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'cache rollback protection: partial backward adjustment must not extend freshness',
    async () => {
      const cookie = await signedInCookie();
      const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
      if (token === undefined) throw new Error('no token');
      const { digestOf } = await import('./domain/secret-values.ts');
      await admin.query(
        "update sessions set step_up_at = clock_timestamp() - interval '15 minutes' + interval '3 seconds' where token_hash = $1",
        [digestOf(token)],
      );
      clock.set(new Date());
      contexts().clearCache();
      try {
        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(200);
        await admin.query('select pg_sleep(2)');
        clock.advance(2000);
        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(200);
        clock.advance(-1000);
        await admin.query('select pg_sleep(1.5)');
        clock.advance(1500);
        const db = await admin.query<{ fresh: boolean }>(
          "select step_up_at > clock_timestamp() - interval '15 minutes' as fresh from sessions where token_hash=$1",
          [digestOf(token)],
        );
        expect(db.rows[0]?.fresh).toBe(false);
        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(403);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'cache TTL: monotonic expiry invalidates cached membership after 30 s under wall adjustment',
    async () => {
      const cookie = await signedInCookie();
      const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
      if (token === undefined) throw new Error('no token');
      const { digestOf } = await import('./domain/secret-values.ts');

      contexts().clearCache();
      const start = new Date();
      clock.set(start);

      expect(
        (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
      ).toBe(200);

      await admin.query(
        'delete from memberships where user_id = (select user_id from sessions where token_hash = $1)',
        [digestOf(token)],
      );

      try {
        clock.advance(31_000);
        clock.set(new Date(start.getTime() + 21_000));

        expect(
          (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
        ).toBe(401);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'session expiry: monotonic expiry invalidates cached authority past session deadline under wall adjustment',
    async () => {
      const cookie = await signedInCookie();
      const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
      if (token === undefined) throw new Error('no token');
      const { digestOf } = await import('./domain/secret-values.ts');

      await admin.query('alter table sessions disable trigger sessions_fixed_lifetime');
      await admin.query(
        "update sessions set idle_expires_at = clock_timestamp() + interval '2 seconds', absolute_expires_at = clock_timestamp() + interval '2 seconds' where token_hash = $1",
        [digestOf(token)],
      );
      await admin.query('alter table sessions enable always trigger sessions_fixed_lifetime');

      contexts().clearCache();
      const start = new Date();
      clock.set(start);

      expect(
        (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
          .statusCode,
      ).toBe(200);

      await admin.query('select pg_sleep(2.5)');

      try {
        clock.advance(2500);
        clock.set(new Date(start.getTime() + 1000));

        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(401);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest(
    'independent application clock offset must not admit a DB-expired session',
    async () => {
      const who = await person();
      await member(who.id, ORG_A);
      const { digestOf, randomSecret } = await import('./domain/secret-values.ts');
      const oldHash = digestOf(randomSecret());
      const token = randomSecret();
      const childHash = digestOf(token);
      const rootId = randomUUID();
      const childId = randomUUID();
      const cookie = `__Host-moin_sid=${token}`;
      await admin.query(
        "with t as materialized (select clock_timestamp() as now) insert into sessions(token_hash,id,family_id,user_id,rotation_reason,created_at,last_seen_at,idle_expires_at,absolute_expires_at,provider_tokens_sealed,provider_tokens_key_id) select $1,$2,$2,$3,'login',t.now-interval '7 days'+interval '2 seconds',t.now,t.now+interval '2 seconds',t.now+interval '2 seconds',$4,'test-v1' from t",
        [oldHash, rootId, who.id, Buffer.alloc(64)],
      );
      const identityCheck = database.identityPool();
      try {
        const rotation = await identityCheck.query(
          "select * from app.rotate_session($1::bytea,$2::bytea,$3::uuid,'step_up'::text,clock_timestamp())",
          [oldHash, childHash, childId],
        );
        expect(rotation.rowCount).toBe(1);
        clock.set(new Date(Date.now() - 5000));
        contexts().clearCache();
        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(200);
        await admin.query('select pg_sleep(2.5)');
        clock.advance(2500);
        const db = await admin.query(
          'select idle_expires_at > clock_timestamp() as idle_valid, absolute_expires_at > clock_timestamp() as absolute_valid from sessions where token_hash=$1',
          [childHash],
        );
        expect(db.rows[0]).toStrictEqual({ idle_valid: false, absolute_valid: false });
        const authoritative = await identityCheck.query(
          'select * from app.resolve_request_context($1::bytea)',
          [childHash],
        );
        expect(authoritative.rowCount).toBe(0);
        expect(
          (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie } }))
            .statusCode,
        ).toBe(401);
      } finally {
        clock.set(new Date());
      }
    },
  );

  evidenceTest('a stamp older than 15 minutes gets 403 step-up-required', async () => {
    const cookie = await signedInCookie();
    const token = /^__Host-moin_sid=([A-Za-z0-9_-]{43})$/.exec(cookie)?.[1];
    if (token === undefined) throw new Error('no token');
    const { digestOf } = await import('./domain/secret-values.ts');
    await admin.query(
      "update sessions set step_up_at = clock_timestamp() - interval '16 minutes' where token_hash = $1",
      [digestOf(token)],
    );
    contexts().clearCache();
    const response = await app.inject({
      method: 'GET',
      url: '/probe/sensitive',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.json()).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  evidenceTest('a step-up round-trip refreshes the stamp and passes the gate', async () => {
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
    const oldToken = SESSION_COOKIE_CONTRACT.exec(
      setCookies(callback.headers).find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
    )?.[1];
    if (oldToken === undefined) throw new Error('no session cookie');
    const oldCookie = `__Host-moin_sid=${oldToken}`;
    // Age the stamp past the window so the gate refuses before the round-trip.
    const { digestOf } = await import('./domain/secret-values.ts');
    await admin.query(
      "update sessions set step_up_at = clock_timestamp() - interval '16 minutes' where token_hash = $1",
      [digestOf(oldToken)],
    );
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie: oldCookie } }))
        .statusCode,
    ).toBe(403);

    // The step-up round-trip: POST starts it, provider re-verifies, callback rotates.
    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/step-up',
      headers: { cookie: oldCookie },
    });
    expect(begun.statusCode).toBe(302);
    expect(String(begun.headers.location)).toContain('max_age=0');
    const upBinding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(begun.headers['set-cookie']),
    )?.[1];
    if (upBinding === undefined) throw new Error('no step-up binding');
    const up = provider.authorize(String(begun.headers.location), {
      subject: who.subject,
      email: who.email,
    });
    const done = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state: up.state, code: up.code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${upBinding}; ${oldCookie}` },
    });
    expect(done.statusCode).toBe(302);
    const newToken = SESSION_COOKIE_CONTRACT.exec(
      setCookies(done.headers).find((c) => c.startsWith('__Host-moin_sid=')) ?? '',
    )?.[1];
    if (newToken === undefined) throw new Error('no successor cookie');
    expect(newToken).not.toBe(oldToken);
    const newCookie = `__Host-moin_sid=${newToken}`;
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe/sensitive', headers: { cookie: newCookie } }))
        .statusCode,
    ).toBe(200);
    // The predecessor died in the rotation.
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: oldCookie } }))
        .statusCode,
    ).toBe(401);
  });

  evidenceTest('a step-up completed as another person rotates nothing', async () => {
    // Subject confusion: the holder's session starts the round-trip, but the provider flow
    // completes as someone else. The callback must refuse and rotate nothing — otherwise a
    // stolen session plus any valid IdP account would mint fresh step-up as the victim.
    const holder = await person();
    await member(holder.id, ORG_A);
    const other = await person();
    await member(other.id, ORG_A);
    const cookie = await signedInCookieAs(holder);
    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/step-up',
      headers: { cookie },
    });
    expect(begun.statusCode).toBe(302);
    const upBinding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(begun.headers['set-cookie']),
    )?.[1];
    if (upBinding === undefined) throw new Error('no step-up binding');
    const up = provider.authorize(String(begun.headers.location), {
      subject: other.subject,
      email: other.email,
    });
    const before = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where revoked_at is null',
    );
    const done = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state: up.state, code: up.code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${upBinding}; ${cookie}` },
    });
    expect(done.statusCode).toBe(400);
    const after = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where revoked_at is null',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // The holder's session still works: nothing was revoked out from under it.
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
  });

  evidenceTest('a removed member cannot start a step-up round-trip', async () => {
    // The step-up route is membership-gated: a session with no active membership gets 401
    // before any provider flow starts, and no auth transaction is minted for it.
    const who = await person();
    await member(who.id, ORG_A);
    const cookie = await signedInCookieAs(who);
    await admin.query('delete from memberships where user_id = $1', [who.id]);
    contexts().clearCache();
    const before = await admin.query<{ n: string }>(
      'select count(*)::text as n from auth_transactions',
    );
    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/step-up',
      headers: { cookie },
    });
    expect(begun.statusCode).toBe(401);
    const after = await admin.query<{ n: string }>(
      'select count(*)::text as n from auth_transactions',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  evidenceTest('a step-up without the session cookie completes nothing', async () => {
    // The callback rotates the presented session: without the session cookie there is no
    // presented session, so the round-trip must refuse and rotate nothing — even though the
    // provider flow itself completed. The holder's session is untouched.
    const cookie = await signedInCookie();
    const begun = await app.inject({
      method: 'POST',
      url: '/api/auth/step-up',
      headers: { cookie },
    });
    expect(begun.statusCode).toBe(302);
    const upBinding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(begun.headers['set-cookie']),
    )?.[1];
    if (upBinding === undefined) throw new Error('no step-up binding');
    const before = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where revoked_at is null',
    );
    // Re-authorize as anybody — subject is irrelevant here; the point is the missing
    // session cookie at callback.
    const up = provider.authorize(String(begun.headers.location), {
      subject: '00000000-0000-4000-8000-000000000001',
      email: 'somebody@example.test',
    });
    const done = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state: up.state, code: up.code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${upBinding}` },
    });
    expect(done.statusCode).toBe(400);
    const after = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where revoked_at is null',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // The legitimate session still works: nothing was revoked out from under it.
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie } })).statusCode,
    ).toBe(200);
  });
});
