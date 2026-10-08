/**
 * P06.07.05: the RBAC matrix against REAL product controllers.
 *
 * The probe matrix (`rbac-matrix.integration.test.ts`) proves the guard enforces the decision
 * table end to end, but against a test controller — every product route × every role was open.
 * This file closes that gap: it mounts the real controllers through `IdentityAccessModule`
 * (the same module production boots, `controllers: []`) and asserts the ROLE guard's verdict
 * per route × role, reading the route table from the controller metadata the guard itself reads.
 *
 * Each actor signs in with a FRESH session (fresh step-up stamp), so the verdict observed is
 * the role guard's, never step-up's. Bodies are minimal-valid; target user ids are staff in
 * the actor's own org (plus a keeper owner so last-owner never trips).
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK, REQUEST_CONTEXTS } from './identity-access.tokens.ts';
import { MembersController } from './http/members.controller.ts';
import { RecoveryController } from './http/recovery.controller.ts';
import { SupportController } from './http/support.controller.ts';
import { CAPABILITIES_KEY } from './http/role.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';
import type { Capability } from './domain/roles.ts';

const LOCAL_KEY = 'local-v1:local-development-only';
const SESSION_COOKIE_CONTRACT =
  /^__Host-moin_sid=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CSRF_COOKIE_CONTRACT =
  /^__Host-moin_csrf=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; Secure; SameSite=Lax$/;
const APP_ORIGIN = 'http://localhost:3000';

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
    controllers: [],
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

function postAs(pair: SessionPair, url: string, body?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: `${pair.header}; ${pair.csrfCookie}`,
      origin: APP_ORIGIN,
      'x-csrf-token': pair.csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  } as Parameters<typeof app.inject>[0]);
}

function getAs(pair: SessionPair, url: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: { cookie: pair.header },
  });
}

async function person(prefix: string) {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `${prefix}-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  return { id, subject, email };
}

async function member(userId: string, org: string, role: string) {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), userId, role, 'active'],
  );
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('rbac-real-routes');
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

/** A fresh org with the actor, a keeper owner (last-owner never trips), and a staff target. */
async function world(role: string): Promise<{
  pair: SessionPair;
  org: string;
  targetId: string;
}> {
  const org = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    org,
    `m-${org.slice(0, 8)}`,
    'Matrix Org',
  ]);
  const actor = await person('mactor');
  await member(actor.id, org, role);
  const keeper = await person('mkeeper');
  await member(keeper.id, org, 'owner');
  const target = await person('mtarget');
  await member(target.id, org, 'staff');
  const pair = await signInPair(actor);
  contexts().clearCache();
  return { pair, org, targetId: target.id };
}

/** Route → capabilities, READ from the real controller metadata the guard itself reads. */
interface RouteSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly capabilities: readonly Capability[];
}

const CONTROLLERS = [MembersController, RecoveryController, SupportController] as const;

function readRoutes(): readonly RouteSpec[] {
  const out: RouteSpec[] = [];
  for (const controller of CONTROLLERS) {
    const prefix = Reflect.getMetadata('path', controller) as string;
    const names = Object.getOwnPropertyNames(controller.prototype).filter(
      (name) => name !== 'constructor',
    );
    for (const name of names) {
      const handler = (controller.prototype as unknown as Record<string, unknown>)[name] as (
        ...args: never[]
      ) => unknown;
      const path = Reflect.getMetadata('path', handler) as string | string[] | undefined;
      const method = Reflect.getMetadata('method', handler) as number | undefined;
      if (path === undefined || method === undefined) continue;
      const capabilities =
        (Reflect.getMetadata(CAPABILITIES_KEY, handler) as readonly Capability[] | undefined) ?? [];
      out.push({
        // Nest Method enum: GET=0, POST=1 — every product route here is one of the two.
        method: method === 0 ? ('GET' as const) : ('POST' as const),
        url: join(prefix, path),
        capabilities,
      });
    }
  }
  return out;
}

function join(prefix: string, path: string | string[]): string {
  const leaf = Array.isArray(path) ? (path[0] ?? '') : path;
  const base = `/${prefix}`.replace(/\/+$/, '');
  return leaf === '' || leaf === '/' ? base : `${base}/${leaf.replace(/^\/+/, '')}`;
}

const ROUTES: readonly RouteSpec[] = readRoutes();

/** Minimal valid body per route; `:id` params resolve against the actor's own org. */
function bodyFor(url: string, targetId: string): Record<string, unknown> | undefined {
  const leaf = url.split('/').pop() ?? '';
  switch (leaf) {
    case 'invite':
      return { email: `neu-${randomUUID().slice(0, 8)}@example.test`, role: 'staff' };
    case 'disable':
    case 'remove':
    case 'transfer-ownership':
    case 'disable-user':
    case 'enable-user':
    case 'revoke-sessions':
      return { userId: targetId, reason: 'password_reset' };
    case 'grants':
      return {
        operatorSubject: 'matrix-probe-operator',
        scope: 'readonly',
        reason: 'matrix probe grant creation',
      };
    default:
      return undefined;
  }
}

/** Issue one live invitation + one live grant in the actor's org; return their ids. */
async function issueLiveIds(pair: SessionPair): Promise<{ invitationId: string; grantId: string }> {
  const invite = await postAs(pair, '/api/members/invite', {
    email: `neu-${randomUUID().slice(0, 8)}@example.test`,
    role: 'staff',
  });
  expect(invite.statusCode).toBe(201);
  const grant = await postAs(pair, '/api/support/grants', {
    operatorSubject: 'matrix-probe-operator',
    scope: 'readonly',
    reason: 'matrix probe grant creation',
  });
  expect(grant.statusCode).toBe(201);
  return {
    invitationId: invite.json<{ invitationId: string }>().invitationId,
    grantId: grant.json<{ grantId: string }>().grantId,
  };
}

evidenceTest('route metadata covers every real product route', () => {
  expect(ROUTES.map((route) => `${route.method} ${route.url}`).sort()).toStrictEqual(
    [
      'GET /api/support/grants',
      'POST /api/members/disable',
      'POST /api/members/invitations/:id/revoke',
      'POST /api/members/invite',
      'POST /api/members/remove',
      'POST /api/members/transfer-ownership',
      'POST /api/recovery/disable-user',
      'POST /api/recovery/enable-user',
      'POST /api/recovery/revoke-sessions',
      'POST /api/support/grants',
      'POST /api/support/grants/:id/revoke',
    ].sort(),
  );
});

describe('the role matrix on real routes, every route × every role (P06.07.05)', () => {
  /** One fresh world per cell: holder routes mutate state (transfer demotes the actor,
   * revoke consumes the row), so cells never share an org. */
  async function callAs(
    role: string,
    route: RouteSpec,
  ): Promise<{ status: number; body: unknown }> {
    const { pair, targetId } = await world(role);
    let url = route.url;
    if (url.includes(':id')) {
      const live = await issueLiveIds(pair);
      url = url.replace(':id', url.includes('invitations') ? live.invitationId : live.grantId);
    }
    if (route.url.endsWith('/enable-user')) {
      // Enable answers 404 on an already-active account (handler, not guard): disable first
      // through the holder's own route, so the cell observes the guard verdict on enable.
      const disabled = await postAs(pair, '/api/recovery/disable-user', {
        userId: targetId,
        reason: 'password_reset',
      });
      if (disabled.statusCode >= 300) return { status: disabled.statusCode, body: disabled.json() };
    }
    const response =
      route.method === 'GET'
        ? await getAs(pair, url)
        : await postAs(pair, url, bodyFor(route.url, targetId));
    return { status: response.statusCode, body: response.json() };
  }

  evidenceTest('owners pass every decorated product route', async () => {
    for (const route of ROUTES) {
      if (route.capabilities.length === 0) continue;
      const { status } = await callAs('owner', route);
      expect(status, `${route.method} ${route.url}`).toBeLessThan(300);
    }
  });

  evidenceTest('admins pass users:manage routes, fail owner-only routes', async () => {
    for (const route of ROUTES) {
      if (route.capabilities.length === 0) continue;
      // Admins cannot issue the live ids the :id routes need (invite is users:manage —
      // they can; grant create is support:grant — they hold it too). Both holder
      // capabilities, so issueLiveIds succeeds for admins as well.
      const { status } = await callAs('admin', route);
      if (route.capabilities.includes('users:manage-owners')) {
        // The guard answers 403 before the handler: admins never hold the owner capability.
        expect(status, `${route.method} ${route.url}`).toBe(403);
      } else {
        expect(status, `${route.method} ${route.url}`).toBeLessThan(300);
      }
    }
  });

  evidenceTest('staff fail every decorated product route with 403 forbidden', async () => {
    for (const route of ROUTES) {
      if (route.capabilities.length === 0) continue;
      // Staff cannot issue live ids — but the guard refuses before the handler reads
      // any id, so an unknown UUID proves the same verdict without a holder's help.
      const { pair, targetId } = await world('staff');
      const url = route.url.replace(':id', randomUUID());
      const response =
        route.method === 'GET'
          ? await getAs(pair, url)
          : await postAs(pair, url, bodyFor(route.url, targetId));
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(response.json()).toStrictEqual({
        type: '/problems/forbidden',
        title: 'Forbidden',
        status: 403,
      });
    }
  });

  evidenceTest('out-of-tenant user ids 404 on holder routes (P06.07.03)', async () => {
    const { pair } = await world('owner');
    const stranger = await person('mstranger');
    const response = await postAs(pair, '/api/members/disable', {
      userId: stranger.id,
      reason: 'password_reset',
    });
    expect(response.statusCode).toBe(404);
  });
});
