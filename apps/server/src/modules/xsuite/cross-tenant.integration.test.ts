/**
 * Cross-tenant security suite v1 (P06.13, LG-P01).
 *
 * Two fully seeded tenants (every tenant table, `seed.ts`) behind the real Nest app with
 * the real controllers mounted. For every route in `INVENTORY`, call as tenant A with
 * tenant B's resource ids and expect the leak-proof answer: 404/empty on id routes, A's
 * rows only on list routes, no tenant data on public routes, 401/403 on forged webhooks.
 * Coverage is computed from Nest metadata against the inventory — 100 % or the suite
 * fails, so a new route without a probe row blocks the release instead of slipping past.
 *
 * What this file does NOT do (honest scope, per PLAN):
 * - Job-layer cross-tenant (P06.03.07 half of P06.13.03): no job envelope exists in the
 *   codebase (worker root is an empty P08 placeholder). The DB-layer suite (P06.02.06,
 *   tenant-isolation) is wired by reference in the coverage report; the job half is
 *   recorded BLOCKED on P06.03.03, not faked.
 * - SSE/cache/S3 positive checks (P06.13.04): none of those surfaces exist. `surface.ts`
 *   asserts the negative registry — the surface is empty — so the day one lands, the
 *   suite fails loudly and forces real checks.
 *
 * Sessions are seeded directly (founder decision): the session row + membership row are
 * the infrastructure the probes stand on, not what's under test. Seeding runs through the
 * migration-role pool; every probe runs through HTTP as `moin_app`, exactly as traffic.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { withTenant } from '@moin/db';
import { fixedClock } from '@moin/kernel';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { IdentityAccessModule } from '../identity-access/identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK } from '../identity-access/identity-access.tokens.ts';
import { registerCorrelation } from '../../observability/correlation.ts';
import { HealthModule } from '../../health/health.module.ts';
import { VoiceModule } from '../voice/voice.module.ts';
import { EXPECTED_ROUTE_COUNT, INVENTORY } from './inventory.ts';
import { reconstructRoutes } from './routes.ts';
import { seedTwoTenants, type SeededWorld } from './seed.ts';
import { ABSENT_SURFACES, assertSurfacesAbsent } from './surface.ts';

/**
 * Routes served by the test app that are NOT product API surface: the voice relay
 * WebSocket (a transport handshake mounted by VoiceModule, not a tenant-data route —
 * its frames carry a per-call token).
 */
const NON_PRODUCT_ROUTES = new Set(['GET /voice/relay']);

const LOCAL_KEY = 'local-v1:local-development-only';
const APP_ORIGIN = 'http://localhost:3000';
const CSRF_HEADER = 'x-csrf-token';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let app: NestFastifyApplication;
let world: SeededWorld;
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
          OIDC_ISSUER_URL: 'http://127.0.0.1:8080/realms/moin-local',
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
      HealthModule,
      VoiceModule,
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
  registerCorrelation(built.getHttpAdapter().getInstance());
  await built.getHttpAdapter().getInstance().ready();
  return built;
}

/** A session cookie pair minted by direct row insert (seeded, not signed-in). */
interface SeededSession {
  readonly header: string;
  readonly csrfToken: string;
  readonly csrfCookie: string;
}

/**
 * Mint a live session for `userId` by inserting the row the guards resolve: token digest,
 * fresh expiries, and (for step-up routes) a fresh `step_up_at`. Mirrors the
 * `begin_session` contract (rotation_reason `login`, family = self, sealed provider
 * tokens present — the live-session CHECK demands them).
 */
async function mintSession(userId: string, freshStepUp: boolean): Promise<SeededSession> {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 11);
  const digest = createHash('sha256').update(token, 'utf8').digest();
  const sessionId = randomUUID();
  // 43-char token shape (base64url of 32 bytes, unpadded) mirrors randomSecret(); the
  // cookie contract is shape-checked before the digest is even read.
  const csrf = randomUUID().replace(/-/g, '').slice(0, 43).padEnd(43, 'A');
  // Expiries use the TEST clock (the guards judge against the database clock, and the
  // fixed test clock is set to wall time in beforeAll — never clock_timestamp() + the
  // full ceiling, which trips the sessions_absolute_ceiling CHECK on skew).
  const now = clock.now();
  const idle = new Date(now.getTime() + 11 * 3_600_000).toISOString();
  const absolute = new Date(now.getTime() + 6 * 86_400_000).toISOString();
  // The step_up column differs by call (fresh stamp or NULL): two literal statements, no
  // interpolation — the lint rule bans building SQL from values, even booleans.
  const columns =
    'insert into sessions (token_hash, id, family_id, user_id, rotation_reason, created_at, last_seen_at, idle_expires_at, absolute_expires_at, step_up_at, provider_tokens_sealed, provider_tokens_key_id)';
  if (freshStepUp) {
    await admin.query(
      `${columns} values ($1::bytea, $2::uuid, $2::uuid, $3::uuid, 'login', $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz, $4::timestamptz, $7::bytea, 'local-v1')`,
      [digest, sessionId, userId, now.toISOString(), idle, absolute, Buffer.alloc(32, 9)],
    );
  } else {
    await admin.query(
      `${columns} values ($1::bytea, $2::uuid, $2::uuid, $3::uuid, 'login', $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz, NULL, $7::bytea, 'local-v1')`,
      [digest, sessionId, userId, now.toISOString(), idle, absolute, Buffer.alloc(32, 9)],
    );
  }
  return {
    header: `__Host-moin_sid=${token}`,
    csrfToken: csrf,
    csrfCookie: `__Host-moin_csrf=${csrf}`,
  };
}

function authed(
  session: SeededSession,
  method: 'GET' | 'POST',
  url: string,
  body?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie: `${session.header}; ${session.csrfCookie}`,
      origin: APP_ORIGIN,
      [CSRF_HEADER]: session.csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  } as Parameters<typeof app.inject>[0]);
}

beforeAll(async () => {
  database = await createTestDatabase('xsuite');
  admin = database.fixturePool();
  world = await seedTwoTenants(admin);
  app = await build();
  clock.set(new Date());
}, 60_000);

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('route inventory covers the whole API surface (P06.13.02)', () => {
  evidenceTest('every mounted route has an inventory row: 100 % or block', () => {
    // Computed from the live Fastify router — the routes the app actually serves
    // (`printRoutes` delegates to the router's `prettyPrint`; the tree walk lives in
    // `routes.ts`, unit-pinned against a captured tree). Compared against the
    // inventory in BOTH directions; an empty reconstruction fails too.
    const instance = app.getHttpAdapter().getInstance() as unknown as {
      printRoutes(): string;
    };
    const printed: string = instance.printRoutes();
    const served = reconstructRoutes(printed);
    expect(served.size).toBeGreaterThan(0);
    for (const known of NON_PRODUCT_ROUTES) served.delete(known);
    const inventoried = new Set(INVENTORY.map((r) => `${r.method} ${r.path}`));
    const unprobed = [...served].filter((route) => !inventoried.has(route));
    const orphaned = [...inventoried].filter((route) => !served.has(route));
    expect({ unprobed, orphaned }).toStrictEqual({ unprobed: [], orphaned: [] });
    // Count pin: a silent shrink of both sides together still fails.
    expect(INVENTORY.length).toBe(EXPECTED_ROUTE_COUNT);
  });

  evidenceTest('unknown routes answer 404, never tenant data', async () => {
    // No file-local probe: the path sits under the real MembersController, so the
    // 404 comes from the product router — through HTTP only, no guard imports.
    const session = await mintSession(world.a.owner.id, true);
    const response = await authed(session, 'GET', '/api/members/no-such-route');
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('xsuite-alpha');
    expect(response.body).not.toContain('xsuite-beta');
  });
});

describe('cross-tenant probes: A calls with B ids (P06.13.02)', () => {
  evidenceTest('id routes 404 on foreign ids and leak nothing', async () => {
    const session = await mintSession(world.a.owner.id, true);
    for (const route of INVENTORY) {
      if (route.class !== 'tenant-id') continue;
      const foreign =
        route.foreignId === 'invitation'
          ? world.b.invitationId
          : route.foreignId === 'grant'
            ? world.b.grantId
            : world.b.owner.id;
      const url =
        route.path.includes(':id') && route.foreignId !== 'user'
          ? route.path.replace(':id', foreign)
          : route.path;
      const body =
        route.foreignId === 'user'
          ? { ...(route.body ?? {}), userId: foreign }
          : (route.body ?? { reason: 'cross-tenant probe' });
      const response = await authed(session, route.method, url, body);
      expect(
        [400, 403, 404].includes(response.statusCode),
        `${route.method} ${route.path} → ${response.statusCode}: ${response.body}`,
      ).toBe(true);
      // Never B's data: the body names no foreign id, no foreign address, no B row.
      expect(response.body).not.toContain(world.b.invitationId);
      expect(response.body).not.toContain(world.b.grantId);
      expect(response.body).not.toContain(world.b.owner.id);
      expect(response.body).not.toContain('xsuite-beta');
    }
  });

  evidenceTest('create routes land in the caller tenant, never the foreign one', async () => {
    // Invite takes an email, not an id: the leak to rule out is creation landing in (or
    // reading from) the wrong tenant. Invite as A, then prove the row is in A and NOT in B.
    const session = await mintSession(world.a.owner.id, true);
    const email = `xsuite-probe-${Date.now()}@example.test`;
    const response = await authed(session, 'POST', '/api/members/invite', {
      email,
      role: 'staff',
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<{ invitationId: string }>().invitationId;
    expect(typeof created).toBe('string');
    const pool = database.pool();
    const inA = await withTenant(pool, world.a.organisationId, (client) =>
      client
        .query('select count(*)::int as n from invitations where id = $1::uuid', [created])
        .then((r) => (r.rows[0] as { n: number }).n),
    );
    expect(inA).toBe(1);
    const inB = await withTenant(pool, world.b.organisationId, (client) =>
      client
        .query('select count(*)::int as n from invitations where id = $1::uuid', [created])
        .then((r) => (r.rows[0] as { n: number }).n),
    );
    expect(inB).toBe(0);
  });

  evidenceTest('list routes show only the caller tenant rows', async () => {
    const session = await mintSession(world.a.owner.id, true);
    const grants = await authed(session, 'GET', '/api/support/grants');
    expect(grants.statusCode).toBe(200);
    const body = grants.body;
    expect(body).toContain(world.a.grantId);
    expect(body).not.toContain(world.b.grantId);
    expect(body).not.toContain('xsuite-beta');
  });

  evidenceTest('public routes answer without tenant data', async () => {
    for (const url of ['/api/auth/login', '/healthz', '/readyz']) {
      const response = await app.inject({ method: 'GET', url });
      expect([200, 302].includes(response.statusCode), `${url} → ${response.statusCode}`).toBe(
        true,
      );
      expect(response.body).not.toContain('xsuite-alpha');
      expect(response.body).not.toContain('xsuite-beta');
    }
    const callback = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=x&state=y',
    });
    expect([400, 302].includes(callback.statusCode)).toBe(true);
    expect(callback.body).not.toContain('xsuite-alpha');
  });

  evidenceTest('forged webhooks are refused before tenancy', async () => {
    for (const url of ['/voice/inbound', '/voice/session-end']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'CallSid=forged&From=%2B491700000000',
      });
      expect([401, 403].includes(response.statusCode), `${url} → ${response.statusCode}`).toBe(
        true,
      );
    }
  });
});

describe('DB layer: every tenant table isolates A from B (P06.13.03)', () => {
  evidenceTest('tenant tables expose no foreign rows to the app role', async () => {
    const pool = database.pool();
    // SELECT/DELETE per table, through withTenant as traffic runs: as A, B's row id
    // selects nothing and deletes nothing. (Grants differ per table by design —
    // invitations and support_access_grants are DEFINER-managed, so the app role
    // holds no DELETE there: the assertion is rowCount 0 whether by policy or by
    // refused grant. Either way nothing of B's is touched through A's context.)
    const idTables = [
      { table: 'locations', id: world.b.locationId },
      { table: 'invitations', id: world.b.invitationId },
      { table: 'support_access_grants', id: world.b.grantId },
    ] as const;
    for (const { table, id } of idTables) {
      // Table names are migration-inventory literals, never caller input: selected by
      // an explicit branch, so no template expression ever carries a table name.
      const selectSql =
        table === 'locations'
          ? 'select count(*)::int as n from locations where id = $1::uuid'
          : table === 'invitations'
            ? 'select count(*)::int as n from invitations where id = $1::uuid'
            : 'select count(*)::int as n from support_access_grants where id = $1::uuid';
      const seen = await withTenant(pool, world.a.organisationId, (client) =>
        client.query(selectSql, [id]).then((r) => (r.rows[0] as { n: number }).n),
      );
      expect(seen, `${table} select`).toBe(0);
      const deleteSql =
        table === 'locations'
          ? 'delete from locations where id = $1::uuid'
          : table === 'invitations'
            ? 'delete from invitations where id = $1::uuid'
            : 'delete from support_access_grants where id = $1::uuid';
      const deleted = await withTenant(pool, world.a.organisationId, (client) =>
        client.query(deleteSql, [id]).then((r) => r.rowCount ?? 0),
      ).catch(() => 0);
      expect(deleted, `${table} delete`).toBe(0);
    }
    // B's rows are untouched: still fully visible to B.
    const bSees = await withTenant(pool, world.b.organisationId, (client) =>
      client
        .query('select count(*)::int as n from locations')
        .then((r) => (r.rows[0] as { n: number }).n),
    );
    expect(bSees).toBe(1);
  });

  evidenceTest('a forged organisation setting cannot escape the tenant', async () => {
    // P06.03.07 (request half): the tenant comes from the session, never from a caller
    // claim. At the DB layer the analogue is WITH CHECK — an insert naming B's org
    // inside A's transaction is refused rather than landing in B.
    const pool = database.pool();
    await expect(
      withTenant(pool, world.a.organisationId, (client) =>
        client.query(
          'insert into locations (organisation_id, id, name) values ($1::uuid, gen_random_uuid(), $2)',
          [world.b.organisationId, 'smuggled'],
        ),
      ),
    ).rejects.toThrow(/row-level security/u);
  });
});

describe('absent surfaces stay absent (P06.13.04)', () => {
  evidenceTest('no SSE, cache-key or S3 surface exists to leak across tenants', () => {
    // Negative registry: these surfaces do not exist, so there is nothing to assert
    // per-tenant about — yet. Each entry names the tripwire that must become a real
    // check the day the surface lands.
    expect(ABSENT_SURFACES.length).toBeGreaterThan(0);
    assertSurfacesAbsent(app);
  });
});
