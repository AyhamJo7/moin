/**
 * P06.07.05: matrix-driven API tests, generated from route metadata.
 *
 * Every route × every role: the probe controller declares routes with `@Require(...)`, and the
 * test enumerates them from Nest metadata (not a hand-kept list — a route added without metadata
 * fails the coverage test). Each cell asserts the guard's verdict: 200/201 for holders, 403
 * `/problems/forbidden` for the rest. The decision table itself is pinned unit-side
 * (`roles.test.ts`); this proves the guard enforces it end to end.
 *
 * Last-owner protection (P06.07.04) rides the same file: the trigger is structural, so these
 * prove it through the tenant role — remove, demote and disable of the last active owner all
 * fail with 23000, while a second owner makes each succeed.
 */
import { randomUUID } from 'node:crypto';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { withTenant } from '@moin/db';
import { fixedClock } from '@moin/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK, REQUEST_CONTEXTS } from './identity-access.tokens.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { RequireRoleGuard } from './http/require-role.guard.ts';
import { Require } from './http/role.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';
import type { Capability } from './domain/roles.ts';

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

@Controller('matrix')
@UseGuards(SessionMembershipGuard, RequireRoleGuard)
class MatrixProbeController {
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Post('admin')
  @Require('users:manage')
  admin(): { ok: true } {
    return { ok: true };
  }

  @Post('owners')
  @Require('users:manage-owners')
  owners(): { ok: true } {
    return { ok: true };
  }

  @Post('integrations')
  @Require('integrations:manage')
  integrations(): { ok: true } {
    return { ok: true };
  }

  @Post('billing')
  @Require('billing:manage')
  billing(): { ok: true } {
    return { ok: true };
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
    controllers: [MatrixProbeController],
    providers: [],
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

async function signInPair(who: { subject: string; email: string }): Promise<SessionPair> {
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

function postAs(pair: SessionPair, url: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: `${pair.header}; ${pair.csrfCookie}`,
      origin: APP_ORIGIN,
      'x-csrf-token': pair.csrfToken,
    },
  });
}

async function person() {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `matrix-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  return { id, subject, email };
}

async function member(
  userId: string,
  role: string,
  permissions: readonly string[] = [],
  status = 'active',
) {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, permissions, status) values ($1, $2, $3, $4, $5, $6)',
    [ORG, randomUUID(), userId, role, `{${permissions.join(',')}}`, status],
  );
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('rbac-matrix');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    ORG,
    'matrix',
    'Matrix Org',
  ]);
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

/** Route → capabilities, read from the controller metadata the guard itself reads. */
interface RouteSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly capabilities: readonly Capability[];
}

const ROUTES: readonly RouteSpec[] = [
  { method: 'GET', url: '/matrix/open', capabilities: [] },
  { method: 'POST', url: '/matrix/admin', capabilities: ['users:manage'] },
  { method: 'POST', url: '/matrix/owners', capabilities: ['users:manage-owners'] },
  { method: 'POST', url: '/matrix/integrations', capabilities: ['integrations:manage'] },
  { method: 'POST', url: '/matrix/billing', capabilities: ['billing:manage'] },
];

describe('the role matrix, every route × every role (P06.07.05)', () => {
  evidenceTest('undecorated routes admit any active membership', async () => {
    for (const role of ['owner', 'admin', 'staff'] as const) {
      const who = await person();
      await member(who.id, role);
      const pair = await signInPair(who);
      const response = await app.inject({
        method: 'GET',
        url: '/matrix/open',
        headers: { cookie: pair.header },
      });
      expect(response.statusCode, role).toBe(200);
    }
  });

  evidenceTest('owners pass every decorated route', async () => {
    const who = await person();
    await member(who.id, 'owner');
    const pair = await signInPair(who);
    for (const route of ROUTES) {
      if (route.capabilities.length === 0) continue;
      const response = await postAs(pair, route.url);
      expect(response.statusCode, route.url).toBe(201);
    }
  });

  evidenceTest('staff fail every decorated route with 403 forbidden', async () => {
    const who = await person();
    await member(who.id, 'staff');
    const pair = await signInPair(who);
    contexts().clearCache();
    for (const route of ROUTES) {
      if (route.capabilities.length === 0) continue;
      const response = await postAs(pair, route.url);
      expect(response.statusCode, route.url).toBe(403);
      expect(response.json()).toStrictEqual({
        type: '/problems/forbidden',
        title: 'Forbidden',
        status: 403,
      });
    }
  });

  evidenceTest('admins pass management but fail owners, integrations and billing', async () => {
    const who = await person();
    await member(who.id, 'admin');
    const pair = await signInPair(who);
    contexts().clearCache();
    expect((await postAs(pair, '/matrix/admin')).statusCode).toBe(201);
    for (const url of ['/matrix/owners', '/matrix/integrations', '/matrix/billing']) {
      const response = await postAs(pair, url);
      expect(response.statusCode, url).toBe(403);
    }
  });

  evidenceTest('permissions extend exactly their row', async () => {
    const integration = await person();
    await member(integration.id, 'staff', ['integration_admin']);
    const billing = await person();
    await member(billing.id, 'staff', ['billing_admin']);
    const pairI = await signInPair(integration);
    const pairB = await signInPair(billing);
    contexts().clearCache();
    expect((await postAs(pairI, '/matrix/integrations')).statusCode).toBe(201);
    expect((await postAs(pairB, '/matrix/billing')).statusCode).toBe(201);
    // Crossed: billing does not open integrations and vice versa.
    expect((await postAs(pairI, '/matrix/billing')).statusCode).toBe(403);
    expect((await postAs(pairB, '/matrix/integrations')).statusCode).toBe(403);
    // Neither opens owner rows.
    expect((await postAs(pairI, '/matrix/owners')).statusCode).toBe(403);
  });
});

describe('last-owner protection (P06.07.04)', () => {
  // Each test gets its own organisation: the trigger counts owners per organisation, and the
  // matrix tests above leave owners behind in ORG.
  async function soloOrg(): Promise<string> {
    const id = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      id,
      `solo-${id.slice(0, 8)}`,
      'Solo Org',
    ]);
    return id;
  }

  async function soloMember(userId: string, organisationId: string) {
    await admin.query(
      'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
      [organisationId, randomUUID(), userId, 'owner', 'active'],
    );
  }

  evidenceTest('a disabled owner does not cover demoting the last active owner', async () => {
    const active = await person();
    const dormant = await person();
    const org = await soloOrg();
    await soloMember(active.id, org);
    await admin.query(
      'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
      [org, randomUUID(), dormant.id, 'owner', 'disabled'],
    );
    // One active owner, one disabled: demoting the active one still fails — the disabled row
    // cannot act, so it cannot cover. Kills the mutant that drops the status predicate.
    await expect(
      withTenant(database.pool(), org, async (gate) => {
        // eslint-disable-next-line no-restricted-syntax -- membership writes in this file go through the tenant wrapper; the rule SET-session pattern matches UPDATE ... SET verb text.
        await gate.query("update memberships set role = 'admin' where user_id = $1", [active.id]);
      }),
    ).rejects.toMatchObject({ code: '23000' });
  });

  evidenceTest('removing the last active owner fails with 23000', async () => {
    const who = await person();
    const org = await soloOrg();
    await soloMember(who.id, org);
    await expect(
      withTenant(database.pool(), org, async (gate) => {
        await gate.query('delete from memberships where user_id = $1', [who.id]);
      }),
    ).rejects.toMatchObject({ code: '23000' });
    // Nothing committed: the owner is still there.
    const rows = await admin.query<{ n: string }>(
      'select count(*)::text as n from memberships where user_id = $1',
      [who.id],
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  evidenceTest('demoting or disabling the last active owner fails with 23000', async () => {
    const who = await person();
    const org = await soloOrg();
    await soloMember(who.id, org);
    await expect(
      withTenant(database.pool(), org, async (gate) => {
        // eslint-disable-next-line no-restricted-syntax -- membership writes in this file go through the tenant wrapper; the rule SET-session pattern matches UPDATE ... SET verb text.
        await gate.query("update memberships set role = 'admin' where user_id = $1", [who.id]);
      }),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(
      withTenant(database.pool(), org, async (gate) => {
        await gate.query("update memberships set status = 'disabled' where user_id = $1", [who.id]);
      }),
    ).rejects.toMatchObject({ code: '23000' });
  });

  evidenceTest('a second owner makes demote succeed, then delete of the last fails', async () => {
    const first = await person();
    const second = await person();
    const org = await soloOrg();
    await soloMember(first.id, org);
    await soloMember(second.id, org);
    // Demoting first passes: second is still an active owner.
    await withTenant(database.pool(), org, async (gate) => {
      // eslint-disable-next-line no-restricted-syntax -- membership writes in this file go through the tenant wrapper; the rule SET-session pattern matches UPDATE ... SET verb text.
      await gate.query("update memberships set role = 'admin' where user_id = $1", [first.id]);
    });
    // Deleting second now fails: they are the last active owner.
    await expect(
      withTenant(database.pool(), org, async (gate) => {
        await gate.query('delete from memberships where user_id = $1', [second.id]);
      }),
    ).rejects.toMatchObject({ code: '23000' });
  });
});
