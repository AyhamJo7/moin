/**
 * M2A on the API: the owner completes a callback task, and the completion stays.
 *
 * Real controllers, guards and PostgreSQL as `moin_app` (NOBYPASSRLS), a session minted by the real
 * sign-in callback (fake OIDC provider) with its CSRF cookie, exactly as the browser holds them.
 * The call enters through `POST /api/dev/simulated-calls`; the owner acts through
 * `POST /api/tasks/:id/complete`. The fixture pool (migration role) only stages tenants and reads
 * the result back, so every assertion is about rows, not response shapes.
 *
 * Synthetic data only (INV-16): `@example.test` addresses and +49 40 numbers from no real plan.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import { verifyAuditChain, withTenant } from '@moin/db';
import {
  SIMULATED_CALL_PATH,
  TODAY_PATH,
  CSRF_HEADER_NAME,
  taskCompletePath,
  taskPath,
  todayResponseSchema,
} from '@moin/contracts';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { IdentityAccessModule } from '../identity-access/identity-access.module.ts';
import { CONTEXT_CLOCK, IDENTITY_CLOCK } from '../identity-access/identity-access.tokens.ts';
import {
  startFakeOidcProvider,
  type FakeOidcProvider,
} from '../identity-access/__fixtures__/fake-oidc-provider.ts';
import { CallSimulatorModule } from '../call-simulator/call-simulator.module.ts';
import { WorkModule } from './work.module.ts';

const LOCAL_KEY = 'local-v1:local-development-only';
const SIMULATOR_TOKEN = 'm2a-simulator-token-0123456789abcdef';
const APP_ORIGIN = 'http://localhost:3000';
const SESSION_COOKIE = /^__Host-moin_sid=([A-Za-z0-9_-]{43});/;
const CSRF_COOKIE = /^__Host-moin_csrf=([A-Za-z0-9_-]{43});/;

const RESTAURANT_NUMBER = '+494011110001';
const OTHER_NUMBER = '+494022220002';
const CALLER = '+4915112345678';
const UTTERANCE = 'Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.';
const DEADLOCK = '40P01';
/** open → in_progress → waiting → done: three guarded moves, three audit events. */
const COMPLETION_MOVES = 3;

interface Person {
  readonly id: string;
  readonly subject: string;
  readonly email: string;
}

/** What a signed-in browser holds: both cookies, and the token it echoes in the header. */
interface Browser {
  readonly cookie: string;
  readonly csrf: string;
}

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let provider: FakeOidcProvider;
let app: NestFastifyApplication;
const clock = fixedClock(new Date());

const restaurant = randomUUID();
const other = randomUUID();
let restaurantOwner: Person;
let otherOwner: Person;
let owner: Browser;
let stranger: Browser;

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
          APP_ORIGIN,
          LOG_LEVEL: 'info',
          DATABASE_URL: database.appUrl,
          OIDC_PROVIDER: 'keycloak',
          OIDC_ISSUER_URL: provider.issuer,
          OIDC_CLIENT_ID: 'moin-web',
          OIDC_CLIENT_SECRET: 'local-development-only',
          OIDC_REDIRECT_URI: `${APP_ORIGIN}/api/auth/callback`,
          AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY,
          IDENTITY_DATABASE_URL: identityUrl(),
          CALL_SIMULATOR_TOKEN: SIMULATOR_TOKEN,
        }),
      ),
      LoggerModule,
      IdentityAccessModule,
      TenantPoolModule,
      WorkModule,
      CallSimulatorModule,
    ],
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

async function person(prefix: string): Promise<Person> {
  const subject = randomUUID();
  const created = {
    id: randomUUID(),
    subject,
    email: `${prefix}-${subject.slice(0, 8)}@example.test`,
  };
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    created.id,
    created.subject,
    created.email,
    'active',
  ]);
  return created;
}

async function tenant(id: string, slug: string, who: Person, number: string) {
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
  const locationId = randomUUID();
  await admin.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
    id,
    locationId,
    `${slug} Haus`,
  ]);
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [id, randomUUID(), who.id, 'owner', 'active'],
  );
  await admin.query(
    'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
    [number, id, locationId, 'active'],
  );
}

/** Signs in through the real login → callback round trip; returns what the browser would hold. */
async function signIn(who: Person, on: NestFastifyApplication = app): Promise<Browser> {
  const started = await on.inject({ method: 'GET', url: '/api/auth/login' });
  expect(started.statusCode).toBe(302);
  const binding = /^__Host-moin_signin=([A-Za-z0-9_-]{43});/.exec(
    String(started.headers['set-cookie']),
  )?.[1];
  if (binding === undefined) throw new Error('no sign-in binding cookie');
  const { code, state } = provider.authorize(String(started.headers.location), {
    subject: who.subject,
    email: who.email,
  });
  const callback = await on.inject({
    method: 'GET',
    url: `/api/auth/callback?${new URLSearchParams({ state, code, iss: provider.issuer }).toString()}`,
    headers: { cookie: `__Host-moin_signin=${binding}` },
  });
  expect(callback.statusCode).toBe(302);
  const cookies = callback.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : [String(cookies)];
  const token = list.map((c) => SESSION_COOKIE.exec(c)?.[1]).find((v) => v !== undefined);
  const csrf = list.map((c) => CSRF_COOKIE.exec(c)?.[1]).find((v) => v !== undefined);
  if (token === undefined || csrf === undefined) throw new Error('no session or csrf cookie');
  return { cookie: `__Host-moin_sid=${token}; __Host-moin_csrf=${csrf}`, csrf };
}

function simulate(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: SIMULATED_CALL_PATH,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SIMULATOR_TOKEN}`,
    },
    payload: JSON.stringify(body),
  });
}

function call(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callSid: `SIM${randomUUID().replaceAll('-', '')}`,
    from: CALLER,
    to: RESTAURANT_NUMBER,
    utterance: UTTERANCE,
    ...overrides,
  };
}

async function newCallback(
  overrides: Record<string, unknown> = {},
): Promise<{ taskId: string; body: Record<string, unknown> }> {
  const body = call(overrides);
  const response = await simulate(body);
  expect(response.statusCode).toBe(201);
  return { taskId: response.json<{ taskId: string }>().taskId, body };
}

function today(who: Browser | null = owner, on: NestFastifyApplication = app) {
  return on.inject({
    method: 'GET',
    url: TODAY_PATH,
    headers: who === null ? {} : { cookie: who.cookie },
  });
}

/** A browser-shaped POST: both cookies, the echoed token, and the app's own origin. */
function complete(
  taskId: string,
  version: unknown,
  who: Browser | null = owner,
  extra: { headers?: Record<string, string>; body?: unknown } = {},
  on: NestFastifyApplication = app,
) {
  return on.inject({
    method: 'POST',
    url: taskCompletePath(taskId),
    headers: {
      'content-type': 'application/json',
      origin: APP_ORIGIN,
      ...(who === null ? {} : { cookie: who.cookie, [CSRF_HEADER_NAME]: who.csrf }),
      ...extra.headers,
    },
    payload: JSON.stringify(extra.body ?? { version }),
  });
}

async function taskRow(taskId: string) {
  const row = await admin.query<{
    organisation_id: string;
    title: string;
    type: string | null;
    status: string;
    version: number;
    conversation_id: string;
  }>(
    'select organisation_id, title, type, status, version, conversation_id from tasks where id = $1',
    [taskId],
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error('no such task');
  return found;
}

async function statusEvents(taskId: string) {
  const result = await admin.query<{
    operation: string;
    actor_id: string | null;
    source: string;
    result: string;
    args_sanitized: { to_status?: number };
    correlation_id: string | null;
  }>(
    `select operation, actor_id, source, result, args_sanitized, correlation_id
     from audit_events where target_id = $1 and operation = 'task.status' order by seq`,
    [taskId],
  );
  return result.rows;
}

async function auditCount(org: string): Promise<number> {
  const result = await admin.query<{ n: number }>(
    'select count(*)::int as n from audit_events where organisation_id = $1',
    [org],
  );
  return result.rows[0]?.n ?? -1;
}

async function taskCount(): Promise<number> {
  const result = await admin.query<{ n: number }>('select count(*)::int as n from tasks');
  return result.rows[0]?.n ?? -1;
}

async function acceptance(conversationId: string) {
  const result = await admin.query<Record<string, unknown>>(
    'select * from callback_acceptances where conversation_id = $1',
    [conversationId],
  );
  return result.rows;
}

async function todayIds(who: Browser = owner): Promise<string[]> {
  const response = await today(who);
  expect(response.statusCode).toBe(200);
  return todayResponseSchema.parse(response.json()).tasks.map((task) => task.id);
}

beforeAll(async () => {
  clock.set(new Date());
  database = await createTestDatabase('m2a-owner-completes');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  restaurantOwner = await person('m2a-restaurant-owner');
  otherOwner = await person('m2a-other-owner');
  await tenant(restaurant, 'm2a-restaurant', restaurantOwner, RESTAURANT_NUMBER);
  await tenant(other, 'm2a-other', otherOwner, OTHER_NUMBER);
  app = await build();
  owner = await signIn(restaurantOwner);
  stranger = await signIn(otherOwner);
}, 60_000);

afterAll(async () => {
  await app.close();
  await provider.close();
  await database.drop();
});

describe('owner completes a callback task (M2A)', () => {
  evidenceTest(
    'a simulated callback is seen, completed with its version, and recorded as the owner’s act',
    async () => {
      const { taskId } = await newCallback();
      const before = await today();
      const listed = todayResponseSchema.parse(before.json()).tasks.find((t) => t.id === taskId);
      expect(listed).toMatchObject({ type: 'callback', status: 'open', version: 1 });
      const tasksBefore = await taskCount();
      const auditBefore = await auditCount(restaurant);
      const conversationId = (await taskRow(taskId)).conversation_id;
      const acceptedBefore = await acceptance(conversationId);
      expect(acceptedBefore).toHaveLength(1);

      const response = await complete(taskId, listed?.version);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.json()).toStrictEqual({
        id: taskId,
        status: 'done',
        version: 1 + COMPLETION_MOVES,
      });

      // The database holds it: status, version, and the same tenant, title and type as before.
      expect(await taskRow(taskId)).toMatchObject({
        organisation_id: restaurant,
        title: 'Rückruf: Tischreservierung',
        type: 'callback',
        status: 'done',
        version: 1 + COMPLETION_MOVES,
      });
      // Exactly the three state-machine moves were audited, each as the owner's own act, on one
      // request id, with opaque status markers (in_progress 1, waiting 2, done 3) and no title.
      const events = await statusEvents(taskId);
      expect(events.map((e) => e.args_sanitized.to_status)).toStrictEqual([1, 2, 3]);
      for (const event of events) {
        expect(event).toMatchObject({
          actor_id: restaurantOwner.id,
          source: 'api',
          result: 'succeeded',
        });
      }
      expect(new Set(events.map((e) => e.correlation_id)).size).toBe(1);
      expect(JSON.stringify(events)).not.toContain('Tischreservierung');
      expect(await auditCount(restaurant)).toBe(auditBefore + COMPLETION_MOVES);
      // Nothing else moved: no new task, the acceptance row is untouched.
      expect(await taskCount()).toBe(tasksBefore);
      expect(await acceptance(conversationId)).toStrictEqual(acceptedBefore);
      const chain = await withTenant(database.pool(), restaurant, (c) => verifyAuditChain(c));
      expect(chain.valid).toBe(true);

      // Read-back through the API: no longer active work, still readable with its history.
      expect(await todayIds()).not.toContain(taskId);
      const shown = await app.inject({
        method: 'GET',
        url: taskPath(taskId),
        headers: { cookie: owner.cookie },
      });
      expect(shown.statusCode).toBe(200);
      expect(shown.json()).toStrictEqual({
        id: taskId,
        status: 'done',
        version: 1 + COMPLETION_MOVES,
      });
    },
  );

  evidenceTest(
    'a completion survives an API restart: a new process reads the same done task',
    async () => {
      const { taskId } = await newCallback();
      expect((await complete(taskId, 1)).statusCode).toBe(200);
      await app.close();
      app = await build();
      owner = await signIn(restaurantOwner);
      stranger = await signIn(otherOwner);
      expect(await todayIds()).not.toContain(taskId);
      const shown = await app.inject({
        method: 'GET',
        url: taskPath(taskId),
        headers: { cookie: owner.cookie },
      });
      expect(shown.json()).toMatchObject({ status: 'done', version: 1 + COMPLETION_MOVES });
    },
  );

  evidenceTest(
    'replaying the original simulated call neither reopens the task nor writes anything',
    async () => {
      const { taskId, body } = await newCallback();
      expect((await complete(taskId, 1)).statusCode).toBe(200);
      const tasksBefore = await taskCount();
      const auditBefore = await auditCount(restaurant);
      const rowBefore = await taskRow(taskId);

      const replay = await simulate(body);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toStrictEqual({ taskId, replayed: true });

      expect(await taskRow(taskId)).toStrictEqual(rowBefore);
      expect(rowBefore).toMatchObject({ status: 'done', version: 1 + COMPLETION_MOVES });
      expect(await taskCount()).toBe(tasksBefore);
      expect(await auditCount(restaurant)).toBe(auditBefore);
      expect(await todayIds()).not.toContain(taskId);
    },
  );

  evidenceTest(
    'a stale version is a 409 that changes nothing, including a repeat of the same request',
    async () => {
      const { taskId } = await newCallback();
      const stale = await complete(taskId, 7);
      expect(stale.statusCode).toBe(409);
      expect(stale.headers['content-type']).toContain('application/problem+json');
      expect(stale.json()).toStrictEqual({
        type: '/problems/version-conflict',
        title: 'The task has changed',
        status: 409,
      });
      expect(await taskRow(taskId)).toMatchObject({ status: 'open', version: 1 });
      expect(await statusEvents(taskId)).toHaveLength(0);

      // The same request twice: one effect. The first lands, the identical retry is refused.
      expect((await complete(taskId, 1)).statusCode).toBe(200);
      const auditAfterFirst = await auditCount(restaurant);
      const repeat = await complete(taskId, 1);
      expect(repeat.statusCode).toBe(409);
      expect(await taskRow(taskId)).toMatchObject({
        status: 'done',
        version: 1 + COMPLETION_MOVES,
      });
      expect(await statusEvents(taskId)).toHaveLength(COMPLETION_MOVES);
      expect(await auditCount(restaurant)).toBe(auditAfterFirst);
    },
  );

  evidenceTest(
    'completing an already completed task with its current version changes nothing',
    async () => {
      const { taskId } = await newCallback();
      expect((await complete(taskId, 1)).statusCode).toBe(200);
      const auditBefore = await auditCount(restaurant);
      const again = await complete(taskId, 1 + COMPLETION_MOVES);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toStrictEqual({
        id: taskId,
        status: 'done',
        version: 1 + COMPLETION_MOVES,
      });
      expect(await auditCount(restaurant)).toBe(auditBefore);
      expect(await statusEvents(taskId)).toHaveLength(COMPLETION_MOVES);
    },
  );

  evidenceTest(
    'a cancelled task cannot be completed: 409, still cancelled, nothing audited',
    async () => {
      const { taskId } = await newCallback();
      await withTenant(database.pool(), restaurant, (client) =>
        client.query("update tasks set status = 'cancelled', version = version + 1 where id = $1", [
          taskId,
        ]),
      );
      const auditBefore = await auditCount(restaurant);
      const response = await complete(taskId, 2);
      expect(response.statusCode).toBe(409);
      expect(await taskRow(taskId)).toMatchObject({ status: 'cancelled', version: 2 });
      expect(await auditCount(restaurant)).toBe(auditBefore);
    },
  );

  evidenceTest(
    'two owners acting on the same version: exactly one completion lands, the other is a 409',
    async () => {
      for (let round = 0; round < 6; round += 1) {
        const { taskId } = await newCallback();
        const [first, second] = await Promise.all([complete(taskId, 1), complete(taskId, 1)]);
        expect([first.statusCode, second.statusCode].sort()).toStrictEqual([200, 409]);
        expect(await taskRow(taskId)).toMatchObject({
          status: 'done',
          version: 1 + COMPLETION_MOVES,
        });
        // One walk only: three events, never six, and no hole in the chain.
        expect(await statusEvents(taskId)).toHaveLength(COMPLETION_MOVES);
      }
      const chain = await withTenant(database.pool(), restaurant, (c) => verifyAuditChain(c));
      expect(chain.valid).toBe(true);
    },
  );

  evidenceTest(
    'completions race with replays and fresh calls without a deadlock or a server error',
    async () => {
      const calls = await Promise.all(Array.from({ length: 6 }, () => newCallback()));
      const fresh = Array.from({ length: 6 }, () => call());
      const results = await Promise.all([
        ...calls.map(({ taskId }) => complete(taskId, 1)),
        ...calls.map(({ body }) => simulate(body)),
        ...fresh.map((body) => simulate(body)),
      ]);
      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s >= 500)).toStrictEqual([]);
      expect(results.map((r) => r.body).join('')).not.toContain(DEADLOCK);
      for (const { taskId, body } of calls) {
        const row = await taskRow(taskId);
        expect(row).toMatchObject({ status: 'done', version: 1 + COMPLETION_MOVES });
        expect(await acceptance(row.conversation_id)).toHaveLength(1);
        const tail = await simulate(body);
        expect(tail.json()).toStrictEqual({ taskId, replayed: true });
        expect(await taskRow(taskId)).toStrictEqual(row);
      }
      const chain = await withTenant(database.pool(), restaurant, (c) => verifyAuditChain(c));
      expect(chain.valid).toBe(true);
    },
  );
});

describe('who may complete a task (M2A)', () => {
  evidenceTest(
    'another tenant’s owner gets the same 404 as for a missing task, and changes nothing',
    async () => {
      const { taskId } = await newCallback();
      const auditBefore = await auditCount(restaurant);
      const foreign = await complete(taskId, 1, stranger);
      const missing = await complete(randomUUID(), 1, stranger);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toStrictEqual(missing.json());
      expect(await taskRow(taskId)).toMatchObject({ status: 'open', version: 1 });
      expect(await auditCount(restaurant)).toBe(auditBefore);
      expect(await auditCount(other)).toBe(0);
      const peek = await app.inject({
        method: 'GET',
        url: taskPath(taskId),
        headers: { cookie: stranger.cookie },
      });
      expect(peek.statusCode).toBe(404);
      expect(await todayIds(stranger)).not.toContain(taskId);
      expect((await complete('not-a-uuid', 1)).statusCode).toBe(404);
    },
  );

  evidenceTest(
    'without a session, CSRF proof or the app’s origin the request is refused before any write',
    async () => {
      const { taskId } = await newCallback();
      const auditBefore = await auditCount(restaurant);
      const refused = [
        await complete(taskId, 1, null),
        await complete(taskId, 1, owner, { headers: { [CSRF_HEADER_NAME]: '' } }),
        await complete(taskId, 1, owner, {
          headers: { [CSRF_HEADER_NAME]: 'A'.repeat(43) },
        }),
        await complete(taskId, 1, owner, { headers: { origin: 'https://evil.example' } }),
      ];
      expect(refused.map((r) => r.statusCode)).toStrictEqual([401, 403, 403, 403]);
      expect(await taskRow(taskId)).toMatchObject({ status: 'open', version: 1 });
      expect(await auditCount(restaurant)).toBe(auditBefore);
      const unsigned = await app.inject({ method: 'GET', url: taskPath(taskId) });
      expect(unsigned.statusCode).toBe(401);
    },
  );

  evidenceTest(
    'the body names a version and nothing else: status, tenant and extra fields are 400',
    async () => {
      const { taskId } = await newCallback();
      const bodies: unknown[] = [
        {},
        { version: '1' },
        { version: 0 },
        { version: 1.5 },
        { version: 1, status: 'done' },
        { version: 1, organisationId: other },
      ];
      for (const body of bodies) {
        const response = await complete(taskId, undefined, owner, { body });
        expect(response.statusCode).toBe(400);
      }
      expect(await taskRow(taskId)).toMatchObject({ status: 'open', version: 1 });
      expect(await statusEvents(taskId)).toHaveLength(0);
    },
  );

  evidenceTest('Today reports the version the next action must present', async () => {
    const { taskId } = await newCallback();
    const response = await today();
    const parsed = todayResponseSchema.parse(response.json());
    expect(parsed.tasks.find((t) => t.id === taskId)?.version).toBe(1);
    expect(
      todayResponseSchema.safeParse({
        truncated: false,
        tasks: [{ ...parsed.tasks[0], version: 0 }],
      }).success,
    ).toBe(false);
  });
});
