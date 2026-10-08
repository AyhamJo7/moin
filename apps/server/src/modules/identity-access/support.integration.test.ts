/**
 * P06.11.05: support access grants end to end — lifecycle over HTTP, grant-gated reads as the
 * support role, and the audit trail proving every access.
 *
 * Through a real Nest app with the SupportController mounted: an owner creates a grant
 * (step-up, 201 + id), lists it (tenant-visible), revokes it (unknown ids 404). The
 * grant-gated reads run as `moin_support_ro` through the DEFINERs on a support connection:
 * no grant → no rows; expired → no rows; revoked → no rows. Every grant lifecycle event and
 * every support read audits in the same commit — with the operator subject, the grant id, and
 * the incident reference where present.
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
import { MemberQueries } from '../platform/member-queries.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK, REQUEST_CONTEXTS } from './identity-access.tokens.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { TenantContextInterceptor } from './http/tenant-context.interceptor.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { RequestContextService } from './application/request-context.service.ts';
import { registerCorrelation } from '../../observability/correlation.ts';

const LOCAL_KEY = 'local-v1:local-development-only';
const SESSION_COOKIE_CONTRACT =
  /^__Host-moin_sid=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CSRF_COOKIE_CONTRACT =
  /^__Host-moin_csrf=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; Secure; SameSite=Lax$/;
const APP_ORIGIN = 'http://localhost:3000';
const OPERATOR = 'support-op-001';

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

/** A support-role connection: what moin_support_ro sees, through the DEFINERs only. */
function supportPool() {
  return app.get(MemberQueries).supportPool();
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

function postAs(pair: SessionPair, url: string, body?: Record<string, string | number>) {
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
  const email = `support-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    'active',
  ]);
  return { id, subject, email };
}

function contexts(): RequestContextService {
  return app.get<RequestContextService>(REQUEST_CONTEXTS);
}

beforeAll(async () => {
  database = await createTestDatabase('support-grants');
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

/** An owner pair in a FRESH org with a keeper, plus a staff member for the roster. */
async function ownerPair(): Promise<{
  pair: SessionPair;
  owner: { id: string };
  org: string;
}> {
  const org = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    org,
    `s-${org.slice(0, 8)}`,
    'Support Org',
  ]);
  const owner = await person();
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), owner.id, 'owner', 'active'],
  );
  const keeper = await person();
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), keeper.id, 'owner', 'active'],
  );
  const staff = await person();
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), staff.id, 'staff', 'active'],
  );
  const pair = await signInPair(owner);
  contexts().clearCache();
  return { pair, owner, org };
}

async function grant(pair: SessionPair, hours = 24): Promise<string> {
  const response = await postAs(pair, '/api/support/grants', {
    operatorSubject: OPERATOR,
    scope: 'readonly',
    reason: 'customer asked for help with sign-in',
    hours,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ grantId: string }>().grantId;
}

describe('grant lifecycle (P06.11.02, P06.11.05)', () => {
  evidenceTest('create lists revoke: tenant-visible grants, unknown revoke 404', async () => {
    const { pair } = await ownerPair();
    const grantId = await grant(pair);
    // Tenant-visible: the guarded org lists its own live grant...
    const listed = await app.inject({
      method: 'GET',
      url: '/api/support/grants',
      headers: { cookie: pair.header },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<{ grants: { grantId: string }[] }>().grants.map((g) => g.grantId),
    ).toStrictEqual([grantId]);
    // ...revokes it, and an unknown id shares one 404.
    expect((await postAs(pair, `/api/support/grants/${grantId}/revoke`)).statusCode).toBe(200);
    const relisted = await app.inject({
      method: 'GET',
      url: '/api/support/grants',
      headers: { cookie: pair.header },
    });
    expect(relisted.json<{ grants: unknown[] }>().grants).toStrictEqual([]);
    expect((await postAs(pair, `/api/support/grants/${randomUUID()}/revoke`)).statusCode).toBe(404);
  });

  evidenceTest('grant create needs step-up: stale sessions cannot hand out access', async () => {
    const { pair } = await ownerPair();
    const token = /__Host-moin_sid=([A-Za-z0-9_-]{43})/.exec(pair.header)?.[1] ?? '';
    const { digestOf } = await import('./domain/secret-values.ts');
    await admin.query(
      "update sessions set step_up_at = clock_timestamp() - interval '16 minutes' where token_hash = $1",
      [digestOf(token)],
    );
    contexts().clearCache();
    const response = await postAs(pair, '/api/support/grants', {
      operatorSubject: OPERATOR,
      scope: 'readonly',
      reason: 'customer asked for help with sign-in',
      hours: 24,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ type: '/problems/step-up-required' });
  });

  evidenceTest('staff cannot create grants: 403 from the role guard', async () => {
    const org = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      org,
      `t-${org.slice(0, 8)}`,
      'Staff Org',
    ]);
    const staff = await person();
    await admin.query(
      'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
      [org, randomUUID(), staff.id, 'staff', 'active'],
    );
    const pair = await signInPair(staff);
    contexts().clearCache();
    const response = await postAs(pair, '/api/support/grants', {
      operatorSubject: OPERATOR,
      scope: 'readonly',
      reason: 'customer asked for help with sign-in',
      hours: 24,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('grant-gated reads as moin_support_ro (P06.11.03, P06.11.05)', () => {
  evidenceTest('no grant → no rows; the roster is empty, not an error', async () => {
    const { org } = await ownerPair();
    const pool = supportPool();
    const rows = await pool.query(
      'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    expect(rows.rows).toHaveLength(0);
  });

  evidenceTest('live grant → rows; expired grant → no rows', async () => {
    const { pair, org } = await ownerPair();
    await grant(pair);
    const pool = supportPool();
    // owner + keeper + staff.
    const grantRow = await admin.query<{ id: string }>(
      'select id from support_access_grants order by created_at desc limit 1',
    );
    const liveGrantId = grantRow.rows[0]?.id;
    const live = await pool.query(
      'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    // owner + keeper + staff.
    expect(live.rows).toHaveLength(3);
    // Age the grant past expiry (DB clock judges liveness): expiry 1 s past, created
    // 1 h past — distance 1 h, inside the 72 h CHECK shape, expiry judged past by the clock.
    await admin.query(
      "update support_access_grants set created_at = clock_timestamp() - interval '1 hour', expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [liveGrantId],
    );
    const expired = await pool.query(
      'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    expect(expired.rows).toHaveLength(0);
  });

  evidenceTest('revoked grant → no rows; other-tenant grant → no rows here', async () => {
    const { pair, org } = await ownerPair();
    const grantId = await grant(pair);
    const pool = supportPool();
    expect((await postAs(pair, `/api/support/grants/${grantId}/revoke`)).statusCode).toBe(200);
    const revoked = await pool.query(
      'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    expect(revoked.rows).toHaveLength(0);
    // A grant for ANOTHER org opens nothing here.
    const otherOrg = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      otherOrg,
      `o-${otherOrg.slice(0, 8)}`,
      'Other Org',
    ]);
    const otherOwner = await person();
    await admin.query(
      'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
      [otherOrg, randomUUID(), otherOwner.id, 'owner', 'active'],
    );
    await withTenant(database.pool(), otherOrg, async (client) => {
      await client.query(
        `insert into support_access_grants (organisation_id, id, operator_subject, scope, reason, created_by, expires_at)
         values ($1, $2, $3, 'readonly', 'other tenant grant', $4, clock_timestamp() + interval '1 hour')`,
        [otherOrg, randomUUID(), OPERATOR, otherOwner.id],
      );
    });
    const crossed = await pool.query(
      'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    expect(crossed.rows).toHaveLength(0);
  });

  evidenceTest('invitation queue hides token digests; audit window is shape-minimal', async () => {
    const { pair, org } = await ownerPair();
    await grant(pair);
    const pool = supportPool();
    const invites = await pool.query(
      'select * from app.support_read_invitations($1::uuid, $2::text, $3::uuid, $4::uuid)',
      [org, OPERATOR, randomUUID(), randomUUID()],
    );
    for (const row of invites.rows as { token_hash?: unknown }[]) {
      expect(row).not.toHaveProperty('token_hash');
    }
    const trail = await pool.query(
      'select * from app.support_read_audit_events($1::uuid, $2::text, $3::uuid, $4::uuid, $5::integer)',
      [org, OPERATOR, randomUUID(), randomUUID(), 50],
    );
    for (const row of trail.rows as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toStrictEqual([
        'created_at',
        'operation',
        'seq',
        'target_kind',
      ]);
    }
  });
});

describe('every access audited (P06.11.04, P06.11.05)', () => {
  evidenceTest(
    'grant create/revoke audit; every support read audits with operator + grant',
    async () => {
      const { pair, org } = await ownerPair();
      const grantId = await grant(pair);
      const pool = supportPool();
      await pool.query(
        'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
        [org, OPERATOR, randomUUID(), randomUUID()],
      );
      await pool.query(
        'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
        [org, OPERATOR, randomUUID(), randomUUID()],
      );
      expect((await postAs(pair, `/api/support/grants/${grantId}/revoke`)).statusCode).toBe(200);
      const ops = await admin.query<{ operation: string; n: string }>(
        `select operation, count(*)::text as n from audit_events where organisation_id = $1
        and operation like 'support.%' group by operation order by operation`,
        [org],
      );
      expect(new Map(ops.rows.map((row) => [row.operation, row.n]))).toStrictEqual(
        new Map([
          ['support.grant_create', '1'],
          ['support.grant_revoke', '1'],
          ['support.read_memberships', '2'],
        ]),
      );
    },
  );

  evidenceTest(
    'emergency access needs an incident ref; audits with flags, not the ref',
    async () => {
      const { org } = await ownerPair();
      const pool = supportPool();
      // Empty reference refused (SQLSTATE 22023: invalid_parameter_value).
      await expect(
        pool.query(
          'select * from app.support_emergency_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)',
          [org, OPERATOR, randomUUID(), randomUUID(), ''],
        ),
      ).rejects.toMatchObject({ code: '22023' });
      // With a reference: rows flow, audit carries flags — never the reference text.
      const rows = await pool.query(
        'select * from app.support_emergency_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)',
        [org, OPERATOR, randomUUID(), randomUUID(), 'INC-2026-001'],
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      const audits = await admin.query<{ validation: unknown; args: unknown }>(
        `select validation, args_sanitized as args from audit_events
        where organisation_id = $1 and operation = 'support.emergency_read'`,
        [org],
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.validation).toStrictEqual({
        incident_ref_present: true,
        emergency: true,
      });
      const text = JSON.stringify(audits.rows[0]);
      expect(text).not.toContain('INC-2026-001');
    },
  );
});
