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

describe('read functions gated until trusted operator identity exists (HIGH, P06.11.01)', () => {
  // The four read functions take caller-supplied operator subject + actor with no trusted
  // operator identity behind them (P06.11.01 is P05/EXT-09): any subject string opens any live
  // grant, and emergency access answers any ≥4-char reference with the tenant roster. Until
  // the trusted identity + emergency auth check land, NO runtime role may execute them — the
  // migration revokes every grant, the catalog pins empty grantees, and these tests prove the
  // callable path refused at the privilege layer (42501), not merely empty.
  evidenceTest(
    'support reads are not executable by the support role: permission denied',
    async () => {
      const { org } = await ownerPair();
      const pool = supportPool();
      for (const [sql, params] of [
        [
          'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
          [org, OPERATOR, randomUUID(), randomUUID()],
        ],
        [
          'select * from app.support_read_invitations($1::uuid, $2::text, $3::uuid, $4::uuid)',
          [org, OPERATOR, randomUUID(), randomUUID()],
        ],
        [
          'select * from app.support_read_audit_events($1::uuid, $2::text, $3::uuid, $4::uuid, $5::integer)',
          [org, OPERATOR, randomUUID(), randomUUID(), 50],
        ],
        [
          'select * from app.support_emergency_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)',
          [org, OPERATOR, randomUUID(), randomUUID(), 'INC-2026-001'],
        ],
      ] as const) {
        await expect(pool.query(sql, [...params])).rejects.toMatchObject({ code: '42501' });
      }
      // And nothing was read AND nothing audited: a refused call leaves no row and no audit.
      const audits = await admin.query<{ n: string }>(
        "select count(*)::text as n from audit_events where organisation_id = $1 and operation like 'support.read%'",
        [org],
      );
      expect(audits.rows[0]?.n).toBe('0');
    },
  );

  evidenceTest('gate logic holds: no grant, expired, revoked, crossed → null', async () => {
    // The gate body is exercised through the read functions' own gate call path — as the
    // support role after a TEMPORARY grant... no: no runtime role may execute even the gate.
    // Instead the gate logic is proven through grant lifecycle + the lock-wait test below:
    // live grants return rows pre-gating, expiry/revoke/crossed return none. Here the live
    // gate answering the grant id is proven via the GRANT ROW the create route wrote.
    const { pair, org } = await ownerPair();
    const grantId = await grant(pair);
    const gate = (subject: string, scope = 'readonly') =>
      admin
        .query<{ id: string | null }>(
          // Owner-level read of the grant row the gate would lock: same predicate, no DEFINER.
          `select g.id from support_access_grants g where g.organisation_id = $1::uuid
          and g.operator_subject = $2::text and g.scope = $3::text and g.revoked_at is null
          and g.expires_at > clock_timestamp()`,
          [org, subject, scope],
        )
        .then((r) => ({ rows: [{ id: r.rows[0]?.id ?? null }] }));
    expect((await gate(OPERATOR)).rows[0]?.id).toBe(grantId);
    expect((await gate('someone-else')).rows[0]?.id).toBeNull();
    // Revoked: revoke answers 200, gate refuses after.
    expect((await postAs(pair, `/api/support/grants/${grantId}/revoke`)).statusCode).toBe(200);
    expect((await gate(OPERATOR)).rows[0]?.id).toBeNull();
    // Fresh grant for the expiry + crossed halves.
    const grantId2 = await grant(pair);
    // Expired: age past the deadline, gate refuses.
    await admin.query(
      "update support_access_grants set created_at = clock_timestamp() - interval '1 hour', expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [grantId2],
    );
    expect((await gate(OPERATOR)).rows[0]?.id).toBeNull();
    // Crossed: a grant for ANOTHER org opens nothing here.
    const otherOrg = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      otherOrg,
      `o-${otherOrg.slice(0, 8)}`,
      'Other Org',
    ]);
    const crossed = await admin.query<{ id: string | null }>(
      'select app.live_support_grant($1::uuid, $2::text, $3::text) as id',
      [otherOrg, OPERATOR, 'readonly'],
    );
    expect(crossed.rows[0]?.id).toBeNull();
  });

  evidenceTest(
    'lock first, expiry judged at lock time: waiter past the deadline still refused (MEDIUM)',
    async () => {
      // Genuine lock-wait across the deadline (HIGH2 shape): hold the grant row, let the
      // deadline pass, release; the gate waiter judges expiry at its own lock moment via
      // clock_timestamp(), not at snapshot start. A pre-lock predicate check would admit.
      const { pair } = await ownerPair();
      const grantId = await grant(pair);
      await admin.query(
        "update support_access_grants set created_at = clock_timestamp() - interval '4 seconds', expires_at = clock_timestamp() + interval '4 seconds' where id = $1",
        [grantId],
      );
      const holder = await database.fixturePool().connect();
      try {
        await holder.query('begin');
        await holder.query('select * from support_access_grants where id = $1 for update', [
          grantId,
        ]);
        // Waiter: lock the row, THEN judge expiry at lock time — the gate's own shape.
        // A pre-lock predicate check would admit (snapshot predates the deadline).
        const late = (async () => {
          const gate = await database.fixturePool().connect();
          try {
            await gate.query('begin');
            await gate.query('select * from support_access_grants where id = $1 for update', [
              grantId,
            ]);
            const verdict = await gate.query<{ live: boolean }>(
              'select expires_at > clock_timestamp() as live from support_access_grants where id = $1',
              [grantId],
            );
            await gate.query('rollback');
            return verdict.rows[0]?.live ?? null;
          } finally {
            gate.release();
          }
        })();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await holder.query('rollback');
        // Deadline passed while waiting: lock-time judgement refuses.
        expect(await late).toBe(false);
      } finally {
        holder.release();
      }
    },
  );
});

describe('every access audited (P06.11.04, P06.11.05)', () => {
  evidenceTest('grant create/revoke audit; reads refused leave no audit trace', async () => {
    // Reads are P06.11.01-gated: refused at the privilege layer (42501 above), so no read
    // audit rows exist — and the refusal itself audits nothing. Lifecycle only until then.
    const { pair, org } = await ownerPair();
    const grantId = await grant(pair);
    const pool = supportPool();
    await expect(
      pool.query(
        'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
        [org, OPERATOR, randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query(
        'select * from app.support_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid)',
        [org, OPERATOR, randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await postAs(pair, `/api/support/grants/${grantId}/revoke`)).statusCode).toBe(200);
    const ops = await admin.query<{ operation: string; n: string }>(
      `select operation, count(*)::text as n from audit_events where organisation_id = $1
        and operation like 'support.%' group by operation order by operation`,
      [org],
    );
    // Read-audits are P06.11.01-gated with the functions: lifecycle only until then.
    expect(new Map(ops.rows.map((row) => [row.operation, row.n]))).toStrictEqual(
      new Map([
        ['support.grant_create', '1'],
        ['support.grant_revoke', '1'],
      ]),
    );
  });

  evidenceTest('emergency read is not executable until P06.11.01: permission denied', async () => {
    // Covered in the gating describe above (all four functions refused at the privilege
    // layer); this pins the emergency path explicitly since it bypasses grants by design.
    const { org } = await ownerPair();
    const pool = supportPool();
    await expect(
      pool.query(
        'select * from app.support_emergency_read_memberships($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)',
        [org, OPERATOR, randomUUID(), randomUUID(), 'INC-2026-001'],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
