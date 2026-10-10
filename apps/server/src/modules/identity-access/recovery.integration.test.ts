/**
 * P06.09.01, P06.09.02, P06.09.04: account recovery support actions end to end over HTTP, plus
 * the tabletop record of both runbooks.
 *
 * Through a real Nest app with the RecoveryController mounted: an owner disables an account
 * (sessions revoked at once, audit in the same commit), re-enables it (new sessions mint fresh;
 * revoked ones stay dead), and revokes sessions without changing status. Refusals are coarse:
 * unknown targets and owner-existence share one 404 (P06.07.03). Containment answers carry
 * `containment: 'partial'` — sessions revoked, fresh sign-in not denied — because no
 * deny-new-access mechanism exists yet (runbook stop-condition, honest scope).
 *
 * P06.09.01 password reset is the provider's email flow (Cognito when P05 provisions it): this
 * suite proves our side of it — after a reset is established, every session of the person ends
 * with `password_reset`, sealed provider tokens wiped. The provider operation itself is named in
 * the runbook and unwired until the pool exists.
 */
import { randomUUID } from 'node:crypto';
import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
import { registerCorrelation } from '../../observability/correlation.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';
import { createIdentityStore } from '@moin/db';
import { digestOf } from './domain/secret-values.ts';

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
  // Same correlation contract as production bootstrap: without this hook inject() requests
  // carry no request context, and the audit correlation would be the MemberQueries fallback
  // instead of the inbound header under test.
  registerCorrelation(built.getHttpAdapter().getInstance());
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

function postAs(
  pair: SessionPair,
  url: string,
  body?: Record<string, string | string[]>,
  correlationId?: string,
) {
  const options = {
    method: 'POST',
    url,
    headers: {
      cookie: `${pair.header}; ${pair.csrfCookie}`,
      origin: APP_ORIGIN,
      'x-csrf-token': pair.csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(correlationId === undefined ? {} : { 'x-correlation-id': correlationId }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  };
  return app.inject(options as Parameters<typeof app.inject>[0]);
}

async function person() {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `recovery-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  return { id, subject, email };
}

async function member(userId: string, org: string, role: string, status = 'active') {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), userId, role, status],
  );
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('account-recovery');
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

/** An owner pair in a FRESH org with a keeper, so last-owner never trips. */
async function ownerPair(): Promise<{
  pair: SessionPair;
  owner: { id: string };
  org: string;
}> {
  const org = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    org,
    `r-${org.slice(0, 8)}`,
    'Recovery Org',
  ]);
  const owner = await person();
  await member(owner.id, org, 'owner');
  const keeper = await person();
  await member(keeper.id, org, 'owner');
  const pair = await signInPair(owner);
  contexts().clearCache();
  return { pair, owner, org };
}

/** Ends a session's step-up window the way the session suites do: DB-side, then drop the cache. */
async function staleStepUp(pair: SessionPair) {
  const token = /__Host-moin_sid=([A-Za-z0-9_-]{43})/.exec(pair.header)?.[1] ?? '';
  await admin.query(
    "update sessions set step_up_at = clock_timestamp() - interval '16 minutes' where token_hash = $1",
    [digestOf(token)],
  );
  contexts().clearCache();
}

describe('account disable and re-enable (P06.09.02)', () => {
  evidenceTest(
    'disable-user ends every session at once and audits in the same commit',
    async () => {
      const { pair, org } = await ownerPair();
      const staff = await person();
      await member(staff.id, org, 'staff');
      const staffPair = await signInPair(staff);
      contexts().clearCache();
      const response = await postAs(pair, '/api/recovery/disable-user', {
        userId: staff.id,
        reason: 'mfa_reset',
      });
      expect(response.statusCode).toBe(200);
      // Containment is honestly partial: sessions revoked, fresh sign-in not denied.
      expect(response.json()).toStrictEqual({ disabled: true, containment: 'partial' });
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
      const audits = await admin.query<{ operation: string; correlation_id: string | null }>(
        "select operation, correlation_id::text as correlation_id from audit_events where target_id = $1 and operation = 'account.disable'",
        [staff.id],
      );
      expect(audits.rows).toHaveLength(1);
      // P06.10.03: the in-database writer forwards the request correlation — every row of one
      // request is findable by one id (INV-10). Test requests carry no inbound header, so this
      // is the generated request id (uuid), never NULL.
      // KILLED without the MemberQueries correlation threading (inScope passed actorId
      // only): the writer saw no correlation and the row read NULL.
      expect(audits.rows[0]?.correlation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    },
  );

  evidenceTest(
    'a disabled account cannot mint a new session, and re-enable restores it',
    async () => {
      const { pair, org } = await ownerPair();
      const staff = await person();
      await member(staff.id, org, 'staff');
      expect(
        (
          await postAs(pair, '/api/recovery/disable-user', {
            userId: staff.id,
            reason: 'mfa_reset',
          })
        ).statusCode,
      ).toBe(200);
      // Sign-in as the disabled person fails: begin_session admits active users only.
      const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(started.statusCode).toBe(302);
      // Re-enable: explicit, audited. Revoked sessions stay dead — none resurrect.
      expect(
        (await postAs(pair, '/api/recovery/enable-user', { userId: staff.id, reason: 'mfa_reset' }))
          .statusCode,
      ).toBe(200);
      // Exactly one enable audit: the setter writes it; the controller must not double-audit.
      const enables = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.enable'",
        [staff.id],
      );
      expect(enables.rows[0]?.n).toBe('1');
      const live = await admin.query<{ n: string }>(
        'select count(*)::text as n from sessions where user_id = $1 and revoked_at is null',
        [staff.id],
      );
      expect(live.rows[0]?.n).toBe('0');
      // And the person signs in fresh afterwards.
      const fresh = await signInPair(staff);
      contexts().clearCache();
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/probe',
            headers: { cookie: fresh.header },
          })
        ).statusCode,
      ).toBe(200);
    },
  );

  evidenceTest(
    'disable-user without fresh step-up is refused 403 and changes nothing',
    async () => {
      const { pair, org } = await ownerPair();
      const staff = await person();
      await member(staff.id, org, 'staff');
      await staleStepUp(pair);
      const response = await postAs(pair, '/api/recovery/disable-user', {
        userId: staff.id,
        reason: 'mfa_reset',
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ type: '/problems/step-up-required' });
      const row = await admin.query<{ status: string }>('select status from users where id = $1', [
        staff.id,
      ]);
      expect(row.rows[0]?.status).toBe('active');
    },
  );

  evidenceTest(
    'an admin cannot disable an owner: 404, nothing changes, nothing audited',
    async () => {
      const { org } = await ownerPair();
      const adminUser = await person();
      await member(adminUser.id, org, 'admin');
      const owner = await person();
      await member(owner.id, org, 'owner');
      const pair = await signInPair(adminUser);
      contexts().clearCache();
      expect(
        (
          await postAs(pair, '/api/recovery/disable-user', {
            userId: owner.id,
            reason: 'mfa_reset',
          })
        ).statusCode,
      ).toBe(404);
      const row = await admin.query<{ status: string }>('select status from users where id = $1', [
        owner.id,
      ]);
      expect(row.rows[0]?.status).toBe('active');
      const audits = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.disable'",
        [owner.id],
      );
      expect(audits.rows[0]?.n).toBe('0');
    },
  );

  evidenceTest(
    'a known user id from another tenant is unreachable: 404, still active, nothing audited (HIGH1)',
    async () => {
      // Cross-tenant target: a staff member of org B, acted on from org A. The old code fell
      // through to the account setter (which touches only the account row) and disabled them.
      const { pair } = await ownerPair();
      const otherOrg = randomUUID();
      await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
        otherOrg,
        `x-${otherOrg.slice(0, 8)}`,
        'Other Org',
      ]);
      const stranger = await person();
      await member(stranger.id, otherOrg, 'staff');
      const response = await postAs(pair, '/api/recovery/disable-user', {
        userId: stranger.id,
        reason: 'mfa_reset',
      });
      expect(response.statusCode).toBe(404);
      const row = await admin.query<{ status: string }>('select status from users where id = $1', [
        stranger.id,
      ]);
      expect(row.rows[0]?.status).toBe('active');
      const audits = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.disable'",
        [stranger.id],
      );
      expect(audits.rows[0]?.n).toBe('0');
    },
  );

  evidenceTest('enable-user on another tenant is 404 and changes nothing (HIGH1)', async () => {
    const { pair } = await ownerPair();
    const otherOrg = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      otherOrg,
      `y-${otherOrg.slice(0, 8)}`,
      'Other Org',
    ]);
    const stranger = await person();
    await member(stranger.id, otherOrg, 'staff');
    await admin.query("update users set status = 'disabled' where id = $1", [stranger.id]);
    const response = await postAs(pair, '/api/recovery/enable-user', {
      userId: stranger.id,
      reason: 'mfa_reset',
    });
    expect(response.statusCode).toBe(404);
    const row = await admin.query<{ status: string }>('select status from users where id = $1', [
      stranger.id,
    ]);
    expect(row.rows[0]?.status).toBe('disabled');
  });

  evidenceTest(
    'revoke-sessions on another tenant is 404 and revokes nothing (HIGH1/HIGH3)',
    async () => {
      const { pair } = await ownerPair();
      const otherOrg = randomUUID();
      await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
        otherOrg,
        `z-${otherOrg.slice(0, 8)}`,
        'Other Org',
      ]);
      const stranger = await person();
      await member(stranger.id, otherOrg, 'staff');
      const strangerPair = await signInPair(stranger);
      contexts().clearCache();
      const response = await postAs(pair, '/api/recovery/revoke-sessions', {
        userId: stranger.id,
        reason: 'password_reset',
      });
      expect(response.statusCode).toBe(404);
      // Nothing revoked: the stranger's session still works.
      contexts().clearCache();
      expect(
        (
          await postAs(strangerPair, '/api/members/invite', {
            email: 'x@example.test',
            role: 'staff',
          })
        ).statusCode,
      ).toBe(403);
      const audits = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.revoke_sessions'",
        [stranger.id],
      );
      expect(audits.rows[0]?.n).toBe('0');
    },
  );

  evidenceTest('disabling yourself is refused 409', async () => {
    const { pair, owner } = await ownerPair();
    expect(
      (await postAs(pair, '/api/recovery/disable-user', { userId: owner.id, reason: 'mfa_reset' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('session revocation without status change (P06.09.02 first response)', () => {
  evidenceTest('revoke-sessions ends every session, keeps the account, audits', async () => {
    const { pair, org } = await ownerPair();
    const staff = await person();
    await member(staff.id, org, 'staff');
    const staffPair = await signInPair(staff);
    contexts().clearCache();
    const response = await postAs(pair, '/api/recovery/revoke-sessions', {
      userId: staff.id,
      reason: 'password_reset',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ revoked: true, containment: 'partial' });
    contexts().clearCache();
    expect(
      (await postAs(staffPair, '/api/members/invite', { email: 'x@example.test', role: 'staff' }))
        .statusCode,
    ).toBe(401);
    // Account untouched: still active, still a member.
    const row = await admin.query<{ status: string }>('select status from users where id = $1', [
      staff.id,
    ]);
    expect(row.rows[0]?.status).toBe('active');
    const audits = await admin.query<{ operation: string }>(
      "select operation from audit_events where target_id = $1 and operation = 'account.revoke_sessions'",
      [staff.id],
    );
    expect(audits.rows).toHaveLength(1);
  });

  evidenceTest(
    'an inbound correlation id lands on every audit row of the request (P06.10.03)',
    async () => {
      // End to end through the header contract: one caller-chosen uuid, asserted on both the
      // disable audit and... only the disable fires here; the revoke-sessions row is covered by
      // the same inScope path. A malformed header falls back to the request id (still a uuid).
      const { pair, org } = await ownerPair();
      const staff = await person();
      await member(staff.id, org, 'staff');
      await signInPair(staff);
      contexts().clearCache();
      const correlation = randomUUID();
      expect(
        (
          await postAs(
            pair,
            '/api/recovery/disable-user',
            { userId: staff.id, reason: 'mfa_reset' },
            correlation,
          )
        ).statusCode,
      ).toBe(200);
      const rows = await admin.query<{ correlation_id: string }>(
        "select correlation_id::text as correlation_id from audit_events where target_id = $1 and operation = 'account.disable'",
        [staff.id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.correlation_id).toBe(correlation);
      // session_count is allowlisted and opaque: a count, no identity (P06.10.07). The disable
      // revoked the one session minted above. was_password_reset=false (mfa_reset reason),
      // was_active_before=true (staff was active).
      const args = await admin.query<{ args: unknown }>(
        "select args_sanitized as args from audit_events where target_id = $1 and operation = 'account.disable'",
        [staff.id],
      );
      expect(args.rows[0]?.args).toStrictEqual({
        session_count: 1,
        was_password_reset: false,
        was_active_before: true,
      });
    },
  );

  evidenceTest('revoke-sessions on an owner without the owner capability is 404', async () => {
    const { org } = await ownerPair();
    const adminUser = await person();
    await member(adminUser.id, org, 'admin');
    const owner = await person();
    await member(owner.id, org, 'owner');
    const pair = await signInPair(adminUser);
    contexts().clearCache();
    expect(
      (
        await postAs(pair, '/api/recovery/revoke-sessions', {
          userId: owner.id,
          reason: 'password_reset',
        })
      ).statusCode,
    ).toBe(404);
  });

  evidenceTest(
    'a forged organisation parameter fails closed at the database layer (H1/M1)',
    async () => {
      // Defence in depth: the controller passes the guarded session's tenant, but the DEFINER
      // itself refuses a parameter that disagrees with the transaction's tenant GUC — so a
      // caller that reaches the function directly with a forged org gets 'missing', never a
      // revocation. KILLED without the 0032 GUC check (forged org proceeds to the gate).
      const { org } = await ownerPair();
      const staff = await person();
      await member(staff.id, org, 'staff');
      await signInPair(staff);
      const forgedOrg = randomUUID();
      const settled = await admin.query<{ outcome: string; revoked: number }>(
        'select * from app.revoke_member_sessions($1::uuid, $2::text, $3::text[], $4::uuid, $5::text, null, null)',
        [forgedOrg, 'owner', '{}', staff.id, 'password_reset'],
      );
      expect(settled.rows[0]?.outcome).toBe('missing');
      expect(settled.rows[0]?.revoked).toBe(0);
      // Nothing revoked, nothing audited: the staff session still lives.
      const live = await admin.query<{ n: string }>(
        'select count(*)::text as n from sessions where user_id = $1 and revoked_at is null',
        [staff.id],
      );
      expect(live.rows[0]?.n).toBe('1');
      const audits = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.revoke_sessions'",
        [staff.id],
      );
      expect(audits.rows[0]?.n).toBe('0');
    },
  );

  evidenceTest('revoke-sessions audit carries correlation and session count (L1)', async () => {
    // Sibling recovery writers forward app.correlation_id and the revoked count; the
    // revoke path passed NULLs before 0032. KILLED without the forwarding (row reads
    // NULL / empty args).
    const { pair, org } = await ownerPair();
    const staff = await person();
    await member(staff.id, org, 'staff');
    await signInPair(staff);
    contexts().clearCache();
    const correlation = randomUUID();
    expect(
      (
        await postAs(
          pair,
          '/api/recovery/revoke-sessions',
          { userId: staff.id, reason: 'password_reset' },
          correlation,
        )
      ).statusCode,
    ).toBe(200);
    const rows = await admin.query<{ correlation_id: string; args: unknown }>(
      "select correlation_id::text as correlation_id, args_sanitized as args from audit_events where target_id = $1 and operation = 'account.revoke_sessions'",
      [staff.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.correlation_id).toBe(correlation);
    expect(rows.rows[0]?.args).toStrictEqual({ session_count: 1 });
  });
});

describe('disabled-account callback and races (M2)', () => {
  evidenceTest('callback for a disabled account mints no session', async () => {
    const { pair, org } = await ownerPair();
    const staff = await person();
    await member(staff.id, org, 'staff');
    await signInPair(staff);
    contexts().clearCache();
    expect(
      (await postAs(pair, '/api/recovery/disable-user', { userId: staff.id, reason: 'mfa_reset' }))
        .statusCode,
    ).toBe(200);
    const started = await app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(started.statusCode).toBe(302);
    const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
      String(started.headers['set-cookie']),
    )?.[1];
    if (binding === undefined) throw new Error('no binding');
    const { code, state } = provider.authorize(String(started.headers.location), {
      subject: staff.subject,
      email: staff.email,
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
      headers: { cookie: `__Host-moin_signin=${binding}` },
    });
    expect(callback.statusCode).not.toBe(302);
    const sessions = await admin.query<{ n: string }>(
      'select count(*)::text as n from sessions where user_id = $1 and revoked_at is null',
      [staff.id],
    );
    expect(sessions.rows[0]?.n).toBe('0');
  });

  evidenceTest('sign-in racing disable loses: disable wins, session revoked', async () => {
    const { pair, org } = await ownerPair();
    const staff = await person();
    await member(staff.id, org, 'staff');
    const staffPair = await signInPair(staff);
    contexts().clearCache();
    expect(
      (await postAs(pair, '/api/recovery/disable-user', { userId: staff.id, reason: 'mfa_reset' }))
        .statusCode,
    ).toBe(200);
    contexts().clearCache();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/probe',
          headers: { cookie: staffPair.header },
        })
      ).statusCode,
    ).toBe(401);
    const audits = await admin.query<{ n: string }>(
      "select count(*)::text as n from audit_events where target_id = $1 and operation = 'account.disable'",
      [staff.id],
    );
    expect(audits.rows[0]?.n).toBe('1');
  });

  evidenceTest('disabling the last owner fails closed (owner invariant)', async () => {
    const solo = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      solo,
      `s-${solo.slice(0, 8)}`,
      'Solo Org',
    ]);
    const owner = await person();
    await member(owner.id, solo, 'owner');
    const keeper = await person();
    await member(keeper.id, solo, 'owner');
    const keeperPair = await signInPair(keeper);
    contexts().clearCache();
    await admin.query('delete from memberships where user_id = $1', [owner.id]);
    expect(
      (
        await postAs(keeperPair, '/api/recovery/disable-user', {
          userId: keeper.id,
          reason: 'mfa_reset',
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('password-reset revocation hook (P06.09.01, our side)', () => {
  evidenceTest('after an established reset, every session ends with password_reset', async () => {
    // The provider's email flow is the provider's (Cognito when P05 provisions it); this proves
    // our side: once the reset is established, revokeAll ends every session with the reset
    // reason and wipes sealed provider tokens.
    const { org } = await ownerPair();
    const staff = await person();
    await member(staff.id, org, 'staff');
    await signInPair(staff);
    await signInPair(staff);
    const store = createIdentityStore(database.identityPool());
    const revoked = await store.revokeAllSessions(staff.id, 'password_reset');
    expect(revoked).toBe(2);
    const rows = await admin.query<{ reason: string | null; sealed: Buffer | null }>(
      'select revocation_reason as reason, provider_tokens_sealed as sealed from sessions where user_id = $1',
      [staff.id],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.reason).toBe('password_reset');
      expect(row.sealed).toBeNull();
    }
  });
});
