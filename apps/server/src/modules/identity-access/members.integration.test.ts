/**
 * P06.08.04: invitations end to end over HTTP, plus the membership lifecycle.
 *
 * Through a real Nest app with the MembersController mounted: an owner issues an invitation
 * (201 + one-time raw token, digest-only at rest), the invitee signs in at the provider and
 * accepts (verified email matched exactly), and the lifecycle routes disable, remove and
 * transfer ownership. Refusals are coarse: reuse, expiry, revocation and wrong-email share one
 * 404 that never confirms whether an invitation exists; removal revokes access on the next
 * mutation through the 0016 trigger (the 30 s GET cache bounds stale reads, P06.06.03).
 */
import { randomUUID } from 'node:crypto';
import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import { withTenant } from '@moin/db';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK, REQUEST_CONTEXTS } from './identity-access.tokens.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';
import { acceptInvitation } from './domain/invitations.ts';
import { digestOf, randomSecret } from './domain/secret-values.ts';

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
class ProbeController {
  @Get()
  read(): { ok: true } {
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
    controllers: [ProbeController],
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

function postAs(pair: SessionPair, url: string, body?: Record<string, string | string[]>) {
  const options = {
    method: 'POST',
    url,
    headers: {
      cookie: `${pair.header}; ${pair.csrfCookie}`,
      origin: APP_ORIGIN,
      'x-csrf-token': pair.csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  };
  return app.inject(options as Parameters<typeof app.inject>[0]);
}

async function person() {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `invite-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  return { id, subject, email };
}

async function member(userId: string, role: string, status = 'active') {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [ORG, randomUUID(), userId, role, status],
  );
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('member-lifecycle');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    ORG,
    'lifecycle',
    'Lifecycle Org',
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

/** An owner session pair, plus a keeper owner so lifecycle writes never trip last-owner. */
async function ownerPair(): Promise<{ pair: SessionPair; owner: { id: string } }> {
  const owner = await person();
  await member(owner.id, 'owner');
  const keeper = await person();
  await member(keeper.id, 'owner');
  const pair = await signInPair(owner);
  contexts().clearCache();
  return { pair, owner };
}

describe('invitations (P06.08.01, P06.08.02, P06.08.04)', () => {
  /** An invitation issued over HTTP, plus the raw token the issuer receives once. */
  async function issue(role = 'staff') {
    const email = `neu-${randomUUID().slice(0, 8)}@example.test`;
    const { pair } = await ownerPair();
    const response = await postAs(pair, '/api/members/invite', { email, role });
    expect(response.statusCode).toBe(201);
    return {
      pair,
      email,
      ...response.json<{ invitationId: string; expiresAt: string; token: string }>(),
    };
  }

  /** Acceptance as the store-layer function runs it: inside the invitation's own tenant. */
  function accept(invitationId: string, token: string, subject: string, email: string) {
    return withTenant(database.pool(), ORG, (client) =>
      acceptInvitation(client, invitationId, token, subject, email),
    );
  }

  evidenceTest('issue returns the raw token once; only a digest rests in the table', async () => {
    const issued = await issue();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await admin.query<{ len: number; email: string; days: number }>(
      `select octet_length(token_hash) as len, email::text as email,
              extract(day from expires_at - created_at)::int as days
         from invitations where id = $1`,
      [issued.invitationId],
    );
    expect(stored.rows[0]).toStrictEqual({ len: 32, email: issued.email, days: 7 });
    const hex = (
      await admin.query<{ v: string }>(
        "select encode(token_hash, 'hex') as v from invitations where id = $1",
        [issued.invitationId],
      )
    ).rows[0]?.v;
    expect(hex).toBe(digestOf(issued.token).toString('hex'));
    expect(hex).not.toContain(issued.token);
  });

  evidenceTest('accept binds a new person: verified email matched exactly', async () => {
    const issued = await issue();
    const subject = randomUUID();
    const result = await accept(
      issued.invitationId,
      issued.token,
      subject,
      issued.email.toUpperCase(),
    );
    expect(result.outcome).toBe('accepted');
    const rows = await admin.query<{ role: string; status: string }>(
      `select m.role, m.status from memberships m join users u on u.id = m.user_id
        where u.cognito_sub = $1`,
      [subject],
    );
    expect(rows.rows[0]).toStrictEqual({ role: 'staff', status: 'active' });
  });

  evidenceTest('reuse of a consumed invitation is refused', async () => {
    const issued = await issue();
    expect(
      (await accept(issued.invitationId, issued.token, randomUUID(), issued.email)).outcome,
    ).toBe('accepted');
    // A different subject presenting the spent token: consumed, no second membership.
    const again = await accept(issued.invitationId, issued.token, randomUUID(), issued.email);
    expect(again.outcome).toBe('consumed');
    const count = await admin.query<{ n: string }>(
      'select count(*)::text as n from memberships m join users u on u.id = m.user_id where u.email = $1',
      [issued.email],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  evidenceTest('a retry by the winner is idempotent, not a duplicate (INV-11)', async () => {
    const issued = await issue();
    const subject = randomUUID();
    const first = await accept(issued.invitationId, issued.token, subject, issued.email);
    const retry = await accept(issued.invitationId, issued.token, subject, issued.email);
    expect(retry.outcome).toBe('already_accepted');
    expect(retry.membershipId).toBe(first.membershipId);
  });

  evidenceTest('an expired invitation is refused', async () => {
    const issued = await issue();
    await admin.query(
      "update invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1",
      [issued.invitationId],
    );
    expect(
      (await accept(issued.invitationId, issued.token, randomUUID(), issued.email)).outcome,
    ).toBe('expired');
  });

  evidenceTest('a wrong-email acceptor is refused and nothing is created', async () => {
    const issued = await issue();
    const subject = randomUUID();
    expect(
      (await accept(issued.invitationId, issued.token, subject, 'fremd@example.test')).outcome,
    ).toBe('email_mismatch');
    const created = await admin.query<{ n: string }>(
      'select count(*)::text as n from users where cognito_sub = $1',
      [subject],
    );
    expect(created.rows[0]?.n).toBe('0');
  });

  evidenceTest('the invitation id alone opens nothing: a wrong token is not_found', async () => {
    const issued = await issue();
    const wrong = await accept(issued.invitationId, randomSecret(), randomUUID(), issued.email);
    expect(wrong.outcome).toBe('not_found');
  });

  evidenceTest('a revoked invitation is refused', async () => {
    const issued = await issue();
    expect(
      (await postAs(issued.pair, `/api/members/invitations/${issued.invitationId}/revoke`))
        .statusCode,
    ).toBe(200);
    expect(
      (await accept(issued.invitationId, issued.token, randomUUID(), issued.email)).outcome,
    ).toBe('revoked');
  });

  evidenceTest('another tenant cannot consume the invitation (RLS)', async () => {
    const issued = await issue();
    const otherOrg = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      otherOrg,
      `o-${otherOrg.slice(0, 8)}`,
      'Other',
    ]);
    const crossed = await withTenant(database.pool(), otherOrg, (client) =>
      acceptInvitation(client, issued.invitationId, issued.token, randomUUID(), issued.email),
    );
    expect(crossed.outcome).toBe('not_found');
  });

  evidenceTest('inviting an owner needs the owner capability', async () => {
    const adminUser = await person();
    await member(adminUser.id, 'admin');
    const keeper = await person();
    await member(keeper.id, 'owner');
    const pair = await signInPair(adminUser);
    contexts().clearCache();
    const response = await postAs(pair, '/api/members/invite', {
      email: 'chef@example.test',
      role: 'owner',
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('membership lifecycle (P06.08.03, P06.08.04)', () => {
  /** Ends a session's step-up window the way the session suites do: DB-side, then drop the cache. */
  async function staleStepUp(pair: SessionPair) {
    const token = /__Host-moin_sid=([A-Za-z0-9_-]{43})/.exec(pair.header)?.[1] ?? '';
    await admin.query(
      "update sessions set step_up_at = clock_timestamp() - interval '16 minutes' where token_hash = $1",
      [digestOf(token)],
    );
    contexts().clearCache();
  }

  evidenceTest('disable ends access on the next mutation (FS-16)', async () => {
    const { pair } = await ownerPair();
    const staff = await person();
    await member(staff.id, 'staff');
    const staffPair = await signInPair(staff);
    contexts().clearCache();
    expect(
      (await app.inject({ method: 'GET', url: '/probe', headers: { cookie: staffPair.header } }))
        .statusCode,
    ).toBe(200);
    expect((await postAs(pair, '/api/members/disable', { userId: staff.id })).statusCode).toBe(200);
    contexts().clearCache();
    expect(
      (await postAs(staffPair, '/api/members/invite', { email: 'x@example.test', role: 'staff' }))
        .statusCode,
    ).toBe(401);
  });

  evidenceTest('remove ends access immediately and revokes every session', async () => {
    const { pair } = await ownerPair();
    const staff = await person();
    await member(staff.id, 'staff');
    const staffPair = await signInPair(staff);
    contexts().clearCache();
    expect((await postAs(pair, '/api/members/remove', { userId: staff.id })).statusCode).toBe(200);
    contexts().clearCache();
    expect(
      (await postAs(staffPair, '/api/members/invite', { email: 'x@example.test', role: 'staff' }))
        .statusCode,
    ).toBe(401);
    const live = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where user_id = $1 and revoked_at is null',
      [staff.id],
    );
    expect(live.rows[0]?.n).toBe('0');
  });

  evidenceTest('remove needs fresh step-up: a stale session is refused 403', async () => {
    const { pair } = await ownerPair();
    const staff = await person();
    await member(staff.id, 'staff');
    await staleStepUp(pair);
    const response = await postAs(pair, '/api/members/remove', { userId: staff.id });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ type: '/problems/step-up-required' });
    const still = await admin.query<{ n: string }>(
      'select count(*)::text as n from memberships where user_id = $1',
      [staff.id],
    );
    expect(still.rows[0]?.n).toBe('1');
  });

  evidenceTest(
    'an admin cannot disable or remove an owner (403), and nothing changes',
    async () => {
      const adminUser = await person();
      await member(adminUser.id, 'admin');
      const owner = await person();
      await member(owner.id, 'owner');
      const keeper = await person();
      await member(keeper.id, 'owner');
      const pair = await signInPair(adminUser);
      contexts().clearCache();
      expect((await postAs(pair, '/api/members/disable', { userId: owner.id })).statusCode).toBe(
        403,
      );
      expect((await postAs(pair, '/api/members/remove', { userId: owner.id })).statusCode).toBe(
        403,
      );
      const row = await admin.query<{ status: string }>(
        'select status from memberships where user_id = $1',
        [owner.id],
      );
      expect(row.rows[0]?.status).toBe('active');
    },
  );

  evidenceTest('removing yourself is refused 409', async () => {
    const { pair, owner } = await ownerPair();
    const response = await postAs(pair, '/api/members/remove', { userId: owner.id });
    expect(response.statusCode).toBe(409);
  });

  evidenceTest('ownership transfer promotes then demotes in one transaction', async () => {
    const { pair, owner } = await ownerPair();
    const successor = await person();
    await member(successor.id, 'admin');
    const response = await postAs(pair, '/api/members/transfer-ownership', {
      userId: successor.id,
    });
    expect(response.statusCode).toBe(200);
    const roles = await admin.query<{ user_id: string; role: string }>(
      'select user_id, role from memberships where organisation_id = $1',
      [ORG],
    );
    const byUser = new Map(roles.rows.map((row) => [row.user_id, row.role]));
    expect(byUser.get(successor.id)).toBe('owner');
    expect(byUser.get(owner.id)).toBe('admin');
  });

  evidenceTest('transfer without fresh step-up is refused 403 and changes nothing', async () => {
    const { pair, owner } = await ownerPair();
    const successor = await person();
    await member(successor.id, 'admin');
    await staleStepUp(pair);
    const response = await postAs(pair, '/api/members/transfer-ownership', {
      userId: successor.id,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toStrictEqual({
      type: '/problems/step-up-required',
      title: 'Step-up verification is required',
      status: 403,
    });
    const roles = await admin.query<{ user_id: string; role: string }>(
      'select user_id, role from memberships where user_id = any($1::uuid[])',
      [[owner.id, successor.id]],
    );
    const byUser = new Map(roles.rows.map((row) => [row.user_id, row.role]));
    expect(byUser.get(owner.id)).toBe('owner');
    expect(byUser.get(successor.id)).toBe('admin');
  });

  evidenceTest('transfer to a disabled member is refused 404 and demotes nobody', async () => {
    const { pair, owner } = await ownerPair();
    const dormant = await person();
    await member(dormant.id, 'admin', 'disabled');
    const response = await postAs(pair, '/api/members/transfer-ownership', { userId: dormant.id });
    expect(response.statusCode).toBe(404);
    const row = await admin.query<{ role: string }>(
      'select role from memberships where user_id = $1',
      [owner.id],
    );
    expect(row.rows[0]?.role).toBe('owner');
  });
});
