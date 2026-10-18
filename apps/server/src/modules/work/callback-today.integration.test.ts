/**
 * M1 vertical slice, end to end on the API: simulated call → callback task → owner's Today.
 *
 * Real controllers, real guards and real PostgreSQL as `moin_app` (NOBYPASSRLS): the simulated
 * call enters through `POST /api/dev/simulated-calls`, the tenant comes from the dialled number's
 * route, and the owner reads the task through `GET /api/today` with a session minted by the real
 * sign-in callback (fake OIDC provider, like the RBAC real-route suite). The fixture pool
 * (migration role) only stages organisations, users and routes, and inspects results.
 *
 * Synthetic data only (INV-16): `@example.test` addresses and +49 40 numbers from no real plan.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { fixedClock } from '@moin/kernel';
import {
  captureCallbackRequest,
  completeTask,
  finaliseInteraction,
  ingestCall,
  setTaskStatus,
  withTenant,
} from '@moin/db';
import {
  SIMULATED_CALL_PATH,
  TODAY_CONTRACT_HEADER,
  TODAY_CONTRACT_VERSIONED,
  TODAY_PATH,
  todayResponseSchema,
} from '@moin/contracts';
import * as preM2a from '@moin/contracts/test-support/pre-m2a-today';
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
const SIMULATOR_TOKEN = 'm1-slice-simulator-token-0123456789abcdef';
const SESSION_COOKIE = /^__Host-moin_sid=([A-Za-z0-9_-]{43});/;

const RESTAURANT_NUMBER = '+494011110001';
const OTHER_NUMBER = '+494022220002';
const QUARANTINED_NUMBER = '+494011110009';
const UNKNOWN_NUMBER = '+494099990009';
const CALLER = '+4915112345678';
const UTTERANCE = 'Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.';

interface Person {
  readonly id: string;
  readonly subject: string;
  readonly email: string;
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

function identityUrl(): string {
  const url = database.identityUrl;
  if (url === undefined) throw new Error('TEST_DATABASE_IDENTITY_URL is required');
  return url;
}

async function build(simulatorToken: string | undefined): Promise<NestFastifyApplication> {
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
          ...(simulatorToken === undefined ? {} : { CALL_SIMULATOR_TOKEN: simulatorToken }),
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

async function tenant(id: string, slug: string, owner: Person, numbers: Record<string, string>) {
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
    [id, randomUUID(), owner.id, 'owner', 'active'],
  );
  for (const [e164, status] of Object.entries(numbers)) {
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, id, locationId, status],
    );
  }
}

/** Signs in through the real login → callback round trip; returns the session cookie header. */
async function signIn(who: Person, on: NestFastifyApplication = app): Promise<string> {
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
  const token = list.map((c) => SESSION_COOKIE.exec(c)?.[1]).find((t) => t !== undefined);
  if (token === undefined) throw new Error('no session cookie');
  return `__Host-moin_sid=${token}`;
}

function simulate(
  body: Record<string, unknown>,
  token: string | null = SIMULATOR_TOKEN,
  on: NestFastifyApplication = app,
) {
  return on.inject({
    method: 'POST',
    url: SIMULATED_CALL_PATH,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
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

async function today(cookie: string | null, on: NestFastifyApplication = app) {
  return on.inject({
    method: 'GET',
    url: TODAY_PATH,
    headers: {
      [TODAY_CONTRACT_HEADER]: TODAY_CONTRACT_VERSIONED,
      ...(cookie === null ? {} : { cookie }),
    },
  });
}

/** A call recorded by another path first (no number unless given) and its finaliser fallback. */
async function callWithFallback(
  callSid: string,
  fromNumber?: string,
): Promise<{ conversationId: string; fallback: string }> {
  return withTenant(database.pool(), restaurant, async (client) => {
    const ingested = await ingestCall(client, {
      providerCallSid: callSid,
      ...(fromNumber === undefined ? {} : { fromNumber }),
    });
    const finalised = await finaliseInteraction(client, ingested.call.conversationId);
    if (finalised.taskId === null) throw new Error('finaliser created no fallback');
    return { conversationId: ingested.call.conversationId, fallback: finalised.taskId };
  });
}

/** The owner closes a task through the task service (audited, versioned), as the app will. */
async function closeTask(taskId: string, to: 'done' | 'cancelled'): Promise<void> {
  await withTenant(database.pool(), restaurant, async (client) => {
    const row = await client.query<{ version: number }>('select version from tasks where id = $1', [
      taskId,
    ]);
    const version = row.rows[0]?.version ?? 0;
    if (to === 'done') await completeTask(client, taskId, version);
    else await setTaskStatus(client, taskId, 'cancelled', version);
  });
}

async function taskRow(taskId: string) {
  const row = await admin.query<{
    id: string;
    title: string;
    type: string | null;
    status: string;
    version: number;
    updated_at: Date;
    conversation_id: string;
  }>(
    'select id, title, type, status, version, updated_at, conversation_id from tasks where id = $1',
    [taskId],
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error('no such task');
  return found;
}

/** Everything a replay must leave alone: the task, its call, outcome, acceptance and audit rows. */
async function snapshot(taskId: string) {
  const task = await taskRow(taskId);
  const rest = await admin.query<Record<string, unknown>>(
    `select c.from_number, c.status as call_status, c.version as call_version,
            c.updated_at as call_updated_at,
            (select count(*)::int from call_events e where e.call_id = c.id) as call_events,
            (select count(*)::int from interaction_outcomes o
               where o.conversation_id = c.conversation_id) as outcomes,
            (select count(*)::int from callback_acceptances a
               where a.conversation_id = c.conversation_id) as acceptances,
            (select count(*)::int from tasks t
               where t.conversation_id = c.conversation_id) as tasks
     from calls c where c.conversation_id = $1`,
    [task.conversation_id],
  );
  const audit = await admin.query<{ n: number }>(
    'select count(*)::int as n from audit_events where organisation_id = $1',
    [restaurant],
  );
  return { task, call: rest.rows[0], audit: audit.rows[0]?.n };
}

async function taskCount(): Promise<number> {
  const result = await admin.query<{ n: number }>('select count(*)::int as n from tasks');
  return result.rows[0]?.n ?? -1;
}

beforeAll(async () => {
  clock.set(new Date());
  database = await createTestDatabase('m1-callback-today');
  admin = database.fixturePool();
  provider = await startFakeOidcProvider(clock);
  restaurantOwner = await person('m1-restaurant-owner');
  otherOwner = await person('m1-other-owner');
  await tenant(restaurant, 'm1-restaurant', restaurantOwner, {
    [RESTAURANT_NUMBER]: 'active',
    [QUARANTINED_NUMBER]: 'quarantined',
  });
  await tenant(other, 'm1-other', otherOwner, { [OTHER_NUMBER]: 'active' });
  app = await build(SIMULATOR_TOKEN);
}, 60_000);

afterAll(async () => {
  await app.close();
  await provider.close();
  await database.drop();
});

describe('simulated callback call → persisted task (M1)', () => {
  evidenceTest('creates one tenant-owned callback task with its call and outcome', async () => {
    const body = call();
    const response = await simulate(body);
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { taskId, replayed } = response.json<{ taskId: string; replayed: boolean }>();
    expect(replayed).toBe(false);

    const task = await admin.query<Record<string, unknown>>(
      `select organisation_id, title, type, status, priority, version, created_at, updated_at,
              conversation_id, idempotency_key
       from tasks where id = $1`,
      [taskId],
    );
    const row = task.rows[0];
    expect(row).toMatchObject({
      organisation_id: restaurant,
      title: 'Rückruf: Tischreservierung',
      type: 'callback',
      status: 'open',
      priority: 'normal',
      version: 1,
    });
    expect(row?.['created_at']).toBeInstanceOf(Date);
    expect(row?.['updated_at']).toBeInstanceOf(Date);
    const conversationId = String(row?.['conversation_id']);
    expect(row?.['idempotency_key']).toBe(`callback-request:${conversationId}`);

    const linked = await admin.query<Record<string, unknown>>(
      `select c.organisation_id, c.status, c.from_number, c.to_number, o.result_code,
              o.handled_automatically
       from calls c join interaction_outcomes o on o.conversation_id = c.conversation_id
       where c.conversation_id = $1`,
      [conversationId],
    );
    expect(linked.rows).toStrictEqual([
      {
        organisation_id: restaurant,
        status: 'completed',
        from_number: CALLER,
        to_number: RESTAURANT_NUMBER,
        result_code: 'callback_requested',
        handled_automatically: true,
      },
    ]);

    // INV-10 / INV-12: the creation is audited, and the audit row carries no caller content.
    const audit = await admin.query<{ row: string }>(
      `select row_to_json(a)::text as row from audit_events a
       where a.target_id = $1 and a.operation = 'task.create'`,
      [taskId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.row).not.toContain('Tisch');
    expect(audit.rows[0]?.row).not.toContain(CALLER);
  });

  evidenceTest('falls back to a generic title when the caller names no topic', async () => {
    const response = await simulate(call({ utterance: 'Können Sie mich bitte zurückrufen?' }));
    expect(response.statusCode).toBe(201);
    const { taskId } = response.json<{ taskId: string }>();
    const title = await admin.query<{ title: string }>('select title from tasks where id = $1', [
      taskId,
    ]);
    expect(title.rows[0]?.title).toBe('Rückruf erbeten');
  });

  evidenceTest(
    "states the reason a caller gave without wegen, and stores none of the caller's words (PRODUCT-01)",
    async () => {
      const marker = `QX${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const response = await simulate(
        call({
          utterance: `Es geht um eine Geburtstagsfeier im Dezember, Referenz ${marker}. Bitte rufen Sie zurück.`,
        }),
      );
      expect(response.statusCode).toBe(201);
      const { taskId } = response.json<{ taskId: string }>();
      const stored = await admin.query<{ title: string }>('select title from tasks where id = $1', [
        taskId,
      ]);
      expect(stored.rows[0]?.title).toBe('Rückruf: Geburtstagsfeier im Dezember');

      // The owner's Today shows the same reason, through the shared contract.
      const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
      expect(view.tasks.find((t) => t.id === taskId)?.title).toBe(
        'Rückruf: Geburtstagsfeier im Dezember',
      );

      // No table of the database holds the utterance (INV-07, INV-12): the marker appears nowhere.
      const holders = await admin.query<{ table_name: string }>(
        `select table_name from (
           select table_name,
                  (xpath('/row/c/text()', query_to_xml(
                     format('select count(*) as c from public.%I t where t::text like %L', table_name, $1::text),
                     false, true, '')))[1]::text::int as n
             from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE') counted
          where n > 0`,
        [`%${marker}%`],
      );
      expect(holders.rows).toStrictEqual([]);

      // The scan can see what is stored: the same query finds the title in the tasks table.
      const control = await admin.query<{ table_name: string }>(
        `select table_name from (
           select table_name,
                  (xpath('/row/c/text()', query_to_xml(
                     format('select count(*) as c from public.%I t where t::text like %L', table_name, $1::text),
                     false, true, '')))[1]::text::int as n
             from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE') counted
          where n > 0`,
        ['%Rückruf: Geburtstagsfeier im Dezember%'],
      );
      expect(control.rows.map((row) => row.table_name)).toContain('tasks');
    },
  );

  evidenceTest('a replayed call keeps the title it was first given (J2)', async () => {
    const callSid = `SIM${randomUUID().replaceAll('-', '')}`;
    const utterance = 'Ich möchte für sechs Personen reservieren. Bitte um Rückruf.';
    const first = await simulate(call({ callSid, utterance }));
    const replay = await simulate(call({ callSid, utterance }));
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toStrictEqual({ ...first.json<object>(), replayed: true });
    const { taskId } = first.json<{ taskId: string }>();
    const rows = await admin.query<{ title: string; version: number }>(
      'select title, version from tasks where id = $1',
      [taskId],
    );
    expect(rows.rows[0]).toStrictEqual({
      title: 'Rückruf: Reservierung für 6 Personen',
      version: 1,
    });
  });
});

describe('the owner reads the task on Today (M1)', () => {
  evidenceTest('returns the persisted task in the shared contract shape', async () => {
    const sid = `SIM${randomUUID().replaceAll('-', '')}`;
    const created = await simulate(call({ callSid: sid }));
    const { taskId } = created.json<{ taskId: string }>();
    const cookie = await signIn(restaurantOwner);

    const response = await today(cookie);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    // The owner app parses with this exact schema; strict objects reject any drift.
    const body = todayResponseSchema.parse(response.json());
    const task = body.tasks.find((t) => t.id === taskId);
    expect(task).toMatchObject({
      title: 'Rückruf: Tischreservierung',
      type: 'callback',
      status: 'open',
      priority: 'normal',
      callerNumber: CALLER,
    });
    const stored = await admin.query<{ created_at: Date }>(
      'select created_at from tasks where id = $1',
      [taskId],
    );
    expect(task?.createdAt).toBe(stored.rows[0]?.created_at.toISOString());
  });

  evidenceTest('another tenant never sees it, and sees its own', async () => {
    const mine = (await simulate(call())).json<{ taskId: string }>().taskId;
    const theirs = (await simulate(call({ to: OTHER_NUMBER }))).json<{ taskId: string }>().taskId;
    const theirRow = await admin.query<{ organisation_id: string }>(
      'select organisation_id from tasks where id = $1',
      [theirs],
    );
    expect(theirRow.rows[0]?.organisation_id).toBe(other);

    const otherView = todayResponseSchema.parse((await today(await signIn(otherOwner))).json());
    const otherIds = otherView.tasks.map((t) => t.id);
    expect(otherIds).toContain(theirs);
    expect(otherIds).not.toContain(mine);

    const ownView = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
    const ownIds = ownView.tasks.map((t) => t.id);
    expect(ownIds).toContain(mine);
    expect(ownIds).not.toContain(theirs);
  });

  evidenceTest(
    'answers a web built before task versions in the shape it enforces, and a newer web with versions (M2D-1)',
    async () => {
      const mine = (await simulate(call())).json<{ taskId: string }>().taskId;
      const theirs = (await simulate(call({ to: OTHER_NUMBER }))).json<{ taskId: string }>().taskId;
      const cookie = await signIn(restaurantOwner);
      const unannounced = await app.inject({ method: 'GET', url: TODAY_PATH, headers: { cookie } });

      // Old web, new API: the frozen contract of the commit before versions parses the answer.
      expect(unannounced.statusCode).toBe(200);
      const oldView = preM2a.todayResponseSchema.parse(unannounced.json());
      expect(JSON.stringify(unannounced.json())).not.toContain('"version"');
      expect(unannounced.headers.vary).toContain(TODAY_CONTRACT_HEADER);
      expect(unannounced.headers['cache-control']).toBe('private, no-store');

      // New web, new API: the same tasks in the same order, each with the stored version.
      const newView = todayResponseSchema.parse((await today(cookie)).json());
      expect(newView.tasks.map((t) => t.id)).toStrictEqual(oldView.tasks.map((t) => t.id));
      const stored = await admin.query<{ version: number }>(
        'select version from tasks where id = $1',
        [mine],
      );
      expect(newView.tasks.find((t) => t.id === mine)?.version).toBe(stored.rows[0]?.version);

      // Tenant isolation holds in the legacy shape as well.
      const ids = oldView.tasks.map((t) => t.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
      const otherOld = await app.inject({
        method: 'GET',
        url: TODAY_PATH,
        headers: { cookie: await signIn(otherOwner) },
      });
      const otherIds = preM2a.todayResponseSchema.parse(otherOld.json()).tasks.map((t) => t.id);
      expect(otherIds).toContain(theirs);
      expect(otherIds).not.toContain(mine);
    },
  );

  evidenceTest(
    'treats any other contract announcement as the legacy shape, and still needs a session',
    async () => {
      await simulate(call());
      const cookie = await signIn(restaurantOwner);
      for (const value of ['', 'Versioned', 'versioned, legacy', '2', 'legacy']) {
        const response = await app.inject({
          method: 'GET',
          url: TODAY_PATH,
          headers: { cookie, [TODAY_CONTRACT_HEADER]: value },
        });
        expect(response.statusCode).toBe(200);
        expect(preM2a.todayResponseSchema.safeParse(response.json()).success).toBe(true);
      }
      const anonymous = await today(null);
      expect(anonymous.statusCode).toBe(401);
      expect(JSON.stringify(anonymous.json())).not.toContain('"version"');
    },
  );

  evidenceTest(
    'shows live work only: done, cancelled and snoozed tasks stay off Today',
    async () => {
      const done = (await simulate(call())).json<{ taskId: string }>().taskId;
      const cancelled = (await simulate(call())).json<{ taskId: string }>().taskId;
      const snoozed = (await simulate(call())).json<{ taskId: string }>().taskId;
      const waiting = (await simulate(call())).json<{ taskId: string }>().taskId;
      await admin.query(`update tasks set status = 'done' where id = $1`, [done]);
      await admin.query(`update tasks set status = 'cancelled' where id = $1`, [cancelled]);
      await admin.query(`update tasks set status = 'waiting' where id = $1`, [waiting]);
      await admin.query(
        `update tasks set snoozed_until = clock_timestamp() + interval '1 day' where id = $1`,
        [snoozed],
      );
      const ids = todayResponseSchema
        .parse((await today(await signIn(restaurantOwner))).json())
        .tasks.map((t) => t.id);
      expect(ids).toContain(waiting);
      expect(ids).not.toContain(done);
      expect(ids).not.toContain(cancelled);
      expect(ids).not.toContain(snoozed);
    },
  );

  evidenceTest('a forged tenant selector does not move the Today read', async () => {
    const theirs = (await simulate(call({ to: OTHER_NUMBER }))).json<{ taskId: string }>().taskId;
    const cookie = await signIn(restaurantOwner);
    const forged = await app.inject({
      method: 'GET',
      url: `${TODAY_PATH}?organisationId=${other}&tenant=${other}`,
      headers: { cookie, 'x-organisation-id': other, 'x-tenant-id': other },
    });
    expect(forged.statusCode).toBe(200);
    expect(forged.body).not.toContain(theirs);
  });
});

describe('fail closed (M1)', () => {
  evidenceTest('Today without a session is 401 and reveals nothing', async () => {
    const anonymous = await today(null);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).not.toContain('Rückruf');
    const bogus = await today(`__Host-moin_sid=${'A'.repeat(43)}`);
    expect(bogus.statusCode).toBe(401);
  });

  evidenceTest('unknown, quarantined and malformed numbers create nothing', async () => {
    const before = await taskCount();
    for (const to of [UNKNOWN_NUMBER, QUARANTINED_NUMBER]) {
      const response = await simulate(call({ to }));
      expect(response.statusCode, to).toBe(404);
      expect(response.json()).toStrictEqual({
        type: '/problems/unrouted-number',
        title: 'Number is not routed',
        status: 404,
      });
    }
    expect((await simulate(call({ to: '040 1111 0001' }))).statusCode).toBe(400);
    expect(await taskCount()).toBe(before);
  });

  evidenceTest('a body that names a tenant is refused, not obeyed', async () => {
    const before = await taskCount();
    const response = await simulate(call({ organisationId: other }));
    expect(response.statusCode).toBe(400);
    expect(await taskCount()).toBe(before);
  });

  evidenceTest('missing or wrong simulator tokens are 401 and write nothing', async () => {
    const before = await taskCount();
    expect((await simulate(call(), null)).statusCode).toBe(401);
    expect((await simulate(call(), `${SIMULATOR_TOKEN}x`)).statusCode).toBe(401);
    expect((await simulate(call(), 'short')).statusCode).toBe(401);
    expect(await taskCount()).toBe(before);
  });

  evidenceTest('the entry point does not exist without a configured token', async () => {
    const inert = await build(undefined);
    try {
      const before = await taskCount();
      const response = await simulate(call(), SIMULATOR_TOKEN, inert);
      expect(response.statusCode).toBe(404);
      expect(await taskCount()).toBe(before);
      // Indistinguishable from a route that is not mounted: same status, body shape and headers.
      const unknown = await inert.inject({
        method: 'POST',
        url: '/api/dev/no-such-route',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${SIMULATOR_TOKEN}` },
        payload: JSON.stringify(call()),
      });
      expect(unknown.statusCode).toBe(404);
      expect(response.json()).toStrictEqual({
        ...unknown.json<Record<string, unknown>>(),
        message: `Cannot POST ${SIMULATED_CALL_PATH}`,
      });
      expect(unknown.json()).toMatchObject({ message: 'Cannot POST /api/dev/no-such-route' });
      expect(response.headers['content-type']).toBe(unknown.headers['content-type']);
      expect(response.headers['cache-control']).toBe(unknown.headers['cache-control']);
    } finally {
      await inert.close();
    }
  });

  evidenceTest(
    'unusable callback numbers and other requests are 422 and write nothing',
    async () => {
      const before = await taskCount();
      for (const from of ['anonymous', RESTAURANT_NUMBER, '+4990012345678', 'not-a-number']) {
        expect((await simulate(call({ from }))).statusCode, from).toBe(422);
      }
      const other = await simulate(call({ utterance: 'Wann haben Sie heute geöffnet?' }));
      expect(other.statusCode).toBe(422);
      expect(other.json()).toMatchObject({ type: '/problems/unsupported-request' });
      expect((await simulate(call({ utterance: ' \u0000\u200b ' }))).statusCode).toBe(400);
      expect((await simulate(call({ utterance: 'x'.repeat(1001) }))).statusCode).toBe(400);
      expect(await taskCount()).toBe(before);
    },
  );
});

describe('repeated delivery (M1, INV-11)', () => {
  evidenceTest('the same CallSid twice yields one task and a replay', async () => {
    const body = call();
    const first = await simulate(body);
    const second = await simulate(body);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toStrictEqual({
      taskId: first.json<{ taskId: string }>().taskId,
      replayed: true,
    });
    const rows = await admin.query<{ tasks: number; calls: number; outcomes: number }>(
      `select (select count(*)::int from tasks t join calls c on c.conversation_id = t.conversation_id
                 where c.provider_call_sid = $1) as tasks,
              (select count(*)::int from calls where provider_call_sid = $1) as calls,
              (select count(*)::int from interaction_outcomes o join calls c
                 on c.conversation_id = o.conversation_id where c.provider_call_sid = $1) as outcomes`,
      [body['callSid']],
    );
    expect(rows.rows[0]).toStrictEqual({ tasks: 1, calls: 1, outcomes: 1 });
  });

  evidenceTest('concurrent deliveries of one CallSid converge on one task', async () => {
    const body = call();
    const responses = await Promise.all(Array.from({ length: 6 }, () => simulate(body)));
    const ids = new Set(responses.map((r) => r.json<{ taskId: string }>().taskId));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(5);
    const count = await admin.query<{ n: number }>(
      `select count(*)::int as n from tasks t join calls c on c.conversation_id = t.conversation_id
       where c.provider_call_sid = $1`,
      [body['callSid']],
    );
    expect(count.rows[0]?.n).toBe(1);
  });
});

describe('calls recorded by another path first (M1)', () => {
  evidenceTest('a call ingested without a task gets its callback task now', async () => {
    const body = call();
    const conversationId = await withTenant(database.pool(), restaurant, (client) =>
      ingestCall(client, { providerCallSid: String(body['callSid']), fromNumber: CALLER }),
    ).then((ingested) => ingested.call.conversationId);
    const response = await simulate(body);
    expect(response.statusCode).toBe(201);
    const { taskId } = response.json<{ taskId: string }>();
    const rows = await admin.query<{ id: string; key: string }>(
      `select id, idempotency_key as key from tasks where conversation_id = $1`,
      [conversationId],
    );
    expect(rows.rows).toStrictEqual([{ id: taskId, key: `callback-request:${conversationId}` }]);
    // And the next delivery is a replay of exactly that task.
    expect((await simulate(body)).json()).toStrictEqual({ taskId, replayed: true });
  });

  evidenceTest('a finaliser fallback already covering the call stands, without a 500', async () => {
    const body = call();
    const { conversationId, fallback } = await withTenant(
      database.pool(),
      restaurant,
      async (client) => {
        const ingested = await ingestCall(client, { providerCallSid: String(body['callSid']) });
        const finalised = await finaliseInteraction(client, ingested.call.conversationId);
        return { conversationId: ingested.call.conversationId, fallback: finalised.taskId };
      },
    );
    expect(fallback).not.toBeNull();
    const response = await simulate(body);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toStrictEqual({ taskId: fallback, replayed: false });
    const counts = await admin.query<{ tasks: number; outcome: string | null }>(
      `select (select count(*)::int from tasks where conversation_id = $1) as tasks,
              (select result_code from interaction_outcomes where conversation_id = $1) as outcome`,
      [conversationId],
    );
    expect(counts.rows[0]).toStrictEqual({ tasks: 1, outcome: 'callback_requested' });
  });
});

describe('a closed fallback never absorbs a callback (M1 hotfix)', () => {
  for (const closed of ['done', 'cancelled'] as const) {
    evidenceTest(
      `a ${closed} fallback stays ${closed}; a new task carries the request`,
      async () => {
        const body = call();
        const { conversationId, fallback } = await callWithFallback(String(body['callSid']));
        await closeTask(fallback, closed);
        const before = await snapshot(fallback);

        const response = await simulate(body);
        expect(response.statusCode).toBe(201);
        const { taskId } = response.json<{ taskId: string }>();
        expect(taskId).not.toBe(fallback);
        // The owner's closed task is exactly as they left it (the call gains its outcome).
        expect((await snapshot(fallback)).task).toStrictEqual(before.task);
        const carrier = await taskRow(taskId);
        expect(carrier).toMatchObject({ status: 'open', title: 'Rückruf: Tischreservierung' });
        const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
        expect(view.tasks.find((t) => t.id === taskId)).toMatchObject({
          type: 'callback',
          callerNumber: CALLER,
        });
        expect((await simulate(body)).json()).toStrictEqual({ taskId, replayed: true });
        const outcomes = await admin.query<{ n: number }>(
          'select count(*)::int as n from interaction_outcomes where conversation_id = $1',
          [conversationId],
        );
        expect(outcomes.rows[0]?.n).toBe(1);
      },
    );
  }
});

describe('F1: replaying an accepted callback never changes business state (M1 hotfix)', () => {
  for (const ownerAction of ['done', 'cancelled'] as const) {
    evidenceTest(
      `adopted fallback, owner sets ${ownerAction}, identical replay leaves it ${ownerAction}`,
      async () => {
        const body = call();
        const { fallback } = await callWithFallback(String(body['callSid']));
        const first = await simulate(body);
        expect(first.statusCode).toBe(201);
        expect(first.json()).toStrictEqual({ taskId: fallback, replayed: false });
        await closeTask(fallback, ownerAction);
        const before = await snapshot(fallback);

        const replay = await simulate(body);
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toStrictEqual({ taskId: fallback, replayed: true });
        // Identity, status, version, timestamps, call, outcome, acceptance and audit: unchanged.
        expect(await snapshot(fallback)).toStrictEqual(before);
        expect(before.task.status).toBe(ownerAction);
      },
    );
  }

  evidenceTest(
    'a task created by the capture and completed stays completed on replay',
    async () => {
      const body = call();
      const { taskId } = (await simulate(body)).json<{ taskId: string }>();
      await closeTask(taskId, 'done');
      const before = await snapshot(taskId);
      expect((await simulate(body)).json()).toStrictEqual({ taskId, replayed: true });
      expect(await snapshot(taskId)).toStrictEqual(before);
    },
  );

  evidenceTest(
    'six concurrent deliveries on an existing call converge on one acceptance',
    async () => {
      const body = call();
      const { conversationId, fallback } = await callWithFallback(String(body['callSid']));
      const responses = await Promise.all(Array.from({ length: 6 }, () => simulate(body)));
      expect(responses.map((r) => r.statusCode).sort()).toStrictEqual([
        200, 200, 200, 200, 200, 201,
      ]);
      for (const r of responses) expect(r.json<{ taskId: string }>().taskId).toBe(fallback);
      const counts = await admin.query<{ acceptances: number; tasks: number; retitles: number }>(
        `select (select count(*)::int from callback_acceptances where conversation_id = $1) as acceptances,
              (select count(*)::int from tasks where conversation_id = $1) as tasks,
              (select count(*)::int from audit_events
                 where target_id = $2 and operation = 'task.retitle') as retitles`,
        [conversationId, fallback],
      );
      expect(counts.rows[0]).toStrictEqual({ acceptances: 1, tasks: 1, retitles: 1 });
    },
  );

  evidenceTest(
    'the finaliser after acceptance changes nothing, and replay still holds',
    async () => {
      const body = call();
      const { taskId } = (await simulate(body)).json<{ taskId: string }>();
      const conversationId = (await taskRow(taskId)).conversation_id;
      const before = await snapshot(taskId);
      const verdict = await withTenant(database.pool(), restaurant, (client) =>
        finaliseInteraction(client, conversationId),
      );
      expect(verdict.verdict).toBe('outcome-existed');
      const tasks = await admin.query<{ n: number }>(
        'select count(*)::int as n from tasks where conversation_id = $1',
        [conversationId],
      );
      expect(tasks.rows[0]?.n).toBe(1);
      expect((await simulate(body)).json()).toStrictEqual({ taskId, replayed: true });
      const after = await snapshot(taskId);
      // Only the finaliser's own audit row is new; the task, call and acceptance are unchanged.
      expect({ ...after, audit: before.audit }).toStrictEqual(before);
    },
  );

  evidenceTest(
    'a distinct later request is not suppressed; a changed request is a conflict',
    async () => {
      const first = call();
      const { taskId } = (await simulate(first)).json<{ taskId: string }>();
      await closeTask(taskId, 'done');
      // A new call from the same caller is a new request: a new open task, the old one untouched.
      const later = await simulate(call({ utterance: 'Bitte um Rückruf wegen der Rechnung' }));
      expect(later.statusCode).toBe(201);
      const laterId = later.json<{ taskId: string }>().taskId;
      expect(laterId).not.toBe(taskId);
      expect((await taskRow(laterId)).status).toBe('open');
      expect((await taskRow(taskId)).status).toBe('done');
      // The same call with a different request is refused and writes nothing.
      const before = await snapshot(taskId);
      const changed = await simulate({ ...first, utterance: 'Rückruf wegen einer Beschwerde' });
      expect(changed.statusCode).toBe(409);
      expect(changed.json()).toMatchObject({ type: '/problems/callback-conflict' });
      expect(await snapshot(taskId)).toStrictEqual(before);
    },
  );
});

describe('F2: an accepted callback keeps what the owner needs to call back (M1 hotfix)', () => {
  evidenceTest(
    'existing call without a number: number stored, fallback retitled, Today shows both',
    async () => {
      // A number no other test uses, so "the other tenant never sees it" is a real assertion.
      const caller = '+4915133334444';
      const body = call({ from: caller });
      const { conversationId, fallback } = await callWithFallback(String(body['callSid']));
      const response = await simulate(body);
      expect(response.json()).toStrictEqual({ taskId: fallback, replayed: false });
      const callRow = await admin.query<{ from_number: string | null }>(
        'select from_number from calls where conversation_id = $1',
        [conversationId],
      );
      expect(callRow.rows[0]?.from_number).toBe(caller);
      expect(await taskRow(fallback)).toMatchObject({
        title: 'Rückruf: Tischreservierung',
        type: 'callback',
        status: 'open',
      });
      const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
      expect(view.tasks.find((t) => t.id === fallback)).toMatchObject({
        title: 'Rückruf: Tischreservierung',
        callerNumber: caller,
        type: 'callback',
      });
      const other = todayResponseSchema.parse((await today(await signIn(otherOwner))).json());
      expect(other.tasks.map((t) => t.id)).not.toContain(fallback);
      expect(JSON.stringify(other)).not.toContain(caller);
    },
  );

  evidenceTest('a different recorded number is a conflict: 409, nothing written', async () => {
    const body = call();
    const recorded = '+4917700000001';
    const { conversationId, fallback } = await callWithFallback(String(body['callSid']), recorded);
    const before = await snapshot(fallback);
    const response = await simulate(body);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: '/problems/callback-conflict' });
    expect(await snapshot(fallback)).toStrictEqual(before);
    const callRow = await admin.query<{ from_number: string }>(
      'select from_number from calls where conversation_id = $1',
      [conversationId],
    );
    expect(callRow.rows[0]?.from_number).toBe(recorded);
  });

  evidenceTest(
    'the same recorded number is accepted; a retitled task is kept and the summary still lands',
    async () => {
      const body = call();
      const { fallback } = await callWithFallback(String(body['callSid']), CALLER);
      await admin.query(`update tasks set title = 'Frau Weber zurückrufen' where id = $1`, [
        fallback,
      ]);
      const before = (await snapshot(fallback)).task;
      const response = await simulate(body);
      expect(response.statusCode).toBe(201);
      const { taskId } = response.json<{ taskId: string }>();
      // The chosen title is never overwritten, and the request's summary is not discarded:
      // a second task carries it.
      expect(taskId).not.toBe(fallback);
      expect((await snapshot(fallback)).task).toStrictEqual(before);
      expect(await taskRow(taskId)).toMatchObject({
        title: 'Rückruf: Tischreservierung',
        status: 'open',
      });
    },
  );
});

describe('Today never hides urgent work behind a long list (M1)', () => {
  evidenceTest('an older urgent task survives 100 newer ones, and truncation is said', async () => {
    const tenantId = randomUUID();
    const owner = await person('m1-busy-owner');
    await tenant(tenantId, 'm1-busy', owner, {});
    const urgent = randomUUID();
    await admin.query(
      `insert into tasks (organisation_id, id, title, type, priority, created_at)
       values ($1, $2, 'Dringend: Kühlung ausgefallen', 'general', 'urgent', now() - interval '2 days')`,
      [tenantId, urgent],
    );
    await admin.query(
      `insert into tasks (organisation_id, id, title, type, created_at)
       select $1, gen_random_uuid(), 'Rückruf ' || n, 'callback', now() - n * interval '1 second'
       from generate_series(1, 105) as n`,
      [tenantId],
    );
    const view = todayResponseSchema.parse((await today(await signIn(owner))).json());
    expect(view.truncated).toBe(true);
    expect(view.tasks).toHaveLength(100);
    expect(view.tasks[0]?.id).toBe(urgent);
  });

  evidenceTest('a short list is not truncated', async () => {
    const view = todayResponseSchema.parse((await today(await signIn(otherOwner))).json());
    expect(view.truncated).toBe(false);
  });
});

describe("titles stay short and are never built from the caller's words (M1, PRODUCT-01 F1)", () => {
  // This test used to send "Rückruf wegen" plus 100 emoji and expect a 72-character title copied from
  // them. Copying caller words into a title is the defect PRODUCT-01 F1 removed; what is kept is that
  // such a call is accepted and served, with the neutral title.
  evidenceTest('an emoji-only topic is accepted and served with the neutral title', async () => {
    const response = await simulate(call({ utterance: `Rückruf wegen ${'🎂'.repeat(100)}` }));
    expect(response.statusCode).toBe(201);
    const { taskId } = response.json<{ taskId: string }>();
    const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
    expect(view.tasks.find((t) => t.id === taskId)?.title).toBe('Rückruf erbeten');
  });
});

/** Names of the public tables whose rows contain the text, in any column (catalogue scan, as owner). */
async function tablesHolding(needle: string): Promise<string[]> {
  const holders = await admin.query<{ table_name: string }>(
    `select table_name from (
       select table_name,
              (xpath('/row/c/text()', query_to_xml(
                 format('select count(*) as c from public.%I t where t::text like %L', table_name, $1::text),
                 false, true, '')))[1]::text::int as n
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE') counted
      where n > 0`,
    [`%${needle}%`],
  );
  return holders.rows.map((row) => row.table_name);
}

/** Row count of every public table, any tenant: a write anywhere shows as a difference. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts = await admin.query<{ table_name: string; n: number }>(
    `select table_name,
            (xpath('/row/c/text()', query_to_xml(
               format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int as n
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  return Object.fromEntries(counts.rows.map((row) => [row.table_name, row.n]));
}

describe('PRODUCT-01 review findings: persisted titles, refusals and replays', () => {
  // [name, utterance, short fragments that must not appear in the title or the response, the whole
  // distinctive text that no table may hold]. Short or hex-like strings are not scanned across the
  // database (they collide with generated ids and the fixtures' own addresses).
  const SENSITIVE = [
    [
      'a PIN',
      'Bitte Rückruf wegen einer Reservierung meine PIN lautet 4821.',
      ['4821', 'PIN'],
      'PIN lautet 4821',
    ],
    [
      'a health disclosure',
      'Bitte Rückruf wegen einer Reservierung ich bin HIV-positiv.',
      ['HIV'],
      'HIV-positiv',
    ],
    [
      'a bank account',
      'Rückruf wegen einer Reservierung IBAN DE02120300000000202051',
      ['DE0212', 'IBAN'],
      'DE02120300000000202051',
    ],
    [
      'a password',
      'Rückruf wegen einer Reservierung mein Passwort ist Sommer2026',
      ['Sommer2026', 'Passwort'],
      'Sommer2026',
    ],
    [
      'a contact',
      'Rückruf wegen einer Reservierung an anna.mueller@example.test oder 040 7654321',
      ['anna.mueller', '7654321'],
      'anna.mueller@example.test',
    ],
    [
      'markup',
      'Rückruf wegen einer Reservierung <script>alert(1)</script>',
      ['<script', 'alert(1)'],
      '<script>alert(1)</script>',
    ],
  ] as const;

  for (const [name, utterance, fragments, scanned] of SENSITIVE) {
    evidenceTest(
      `${name} after "wegen" reaches neither the response, the task, nor Today`,
      async () => {
        const response = await simulate(call({ utterance }));
        expect(response.statusCode).toBe(201);
        const { taskId } = response.json<{ taskId: string }>();
        const stored = await taskRow(taskId);
        const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
        const served = view.tasks.find((t) => t.id === taskId)?.title;
        for (const fragment of fragments) {
          expect(response.body, 'simulator response').not.toContain(fragment);
          expect(stored.title, 'persisted task title').not.toContain(fragment);
          expect(served, 'Today projection').not.toContain(fragment);
        }
        // Checked in every table, as the one channel this suite can inspect; it says nothing about logs.
        expect(await tablesHolding(scanned), `tables holding "${scanned}"`).toStrictEqual([]);
        expect(stored.title).toBe('Rückruf: Reservierung');
        expect(served).toBe('Rückruf: Reservierung');
      },
    );
  }

  evidenceTest('a refusal of the callback is 422 and writes nothing anywhere', async () => {
    for (const utterance of [
      'Bitte nicht zurückrufen, ich möchte nicht reservieren, meine PIN lautet 4821.',
      'Ich möchte keinen Rückruf.',
      'Rufen Sie mich nicht zurück.',
    ]) {
      const before = await rowCounts();
      const response = await simulate(call({ utterance }));
      expect(response.statusCode, utterance).toBe(422);
      expect(response.json()).toMatchObject({ type: '/problems/unsupported-request' });
      expect(await rowCounts(), `row counts after: ${utterance}`).toStrictEqual(before);
      expect(await tablesHolding('meine PIN lautet 4821')).toStrictEqual([]);
    }
  });

  evidenceTest(
    'the row-count comparison does see an accepted callback (positive control)',
    async () => {
      const before = await rowCounts();
      expect((await simulate(call())).statusCode).toBe(201);
      const after = await rowCounts();
      expect(after['tasks']).toBe((before['tasks'] ?? 0) + 1);
      expect(after['callback_acceptances']).toBe((before['callback_acceptances'] ?? 0) + 1);
    },
  );

  evidenceTest(
    'a positive request with an unrelated negation still creates the callback',
    async () => {
      const response = await simulate(
        call({ utterance: 'Ich möchte nicht online buchen, bitte rufen Sie mich zurück' }),
      );
      expect(response.statusCode).toBe(201);
      const { taskId } = response.json<{ taskId: string }>();
      expect((await taskRow(taskId)).title).toBe('Rückruf erbeten');
    },
  );

  evidenceTest(
    'a completed callback replayed with the same words is not reopened (J2)',
    async () => {
      const body = call({
        utterance: 'Es geht um eine Geburtstagsfeier im Dezember. Bitte rufen Sie zurück.',
      });
      const first = await simulate(body);
      expect(first.statusCode).toBe(201);
      const { taskId } = first.json<{ taskId: string }>();
      expect((await taskRow(taskId)).title).toBe('Rückruf: Geburtstagsfeier im Dezember');
      await closeTask(taskId, 'done');
      const completed = await taskRow(taskId);
      const before = await rowCounts();
      const replay = await simulate(body);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toStrictEqual({ taskId, replayed: true });
      expect(await taskRow(taskId)).toStrictEqual(completed);
      expect(await rowCounts()).toStrictEqual(before);
    },
  );

  evidenceTest(
    'a call accepted under the earlier rules is refused, not duplicated, when its words now read differently',
    async () => {
      // The title takes part in the acceptance's request hash. A call stored by the rejected version
      // with a copied title ("Rückruf: Gutscheins") and delivered again with the same words now
      // interprets to the neutral title: a documented 409 (request differs), never a second task.
      const callSid = `SIM${randomUUID().replaceAll('-', '')}`;
      const stored = await withTenant(database.pool(), restaurant, (client) =>
        captureCallbackRequest(client, {
          providerCallSid: callSid,
          fromNumber: CALLER,
          toNumber: RESTAURANT_NUMBER,
          title: 'Rückruf: Gutscheins',
        }),
      );
      const taskId = stored.taskId ?? '';
      const before = await rowCounts();
      const replay = await simulate(
        call({
          callSid,
          utterance: 'Können Sie mich zurückrufen? Es geht wegen meines Gutscheins',
        }),
      );
      expect(replay.statusCode).toBe(409);
      expect(replay.json()).toMatchObject({ type: '/problems/callback-conflict' });
      expect(await rowCounts()).toStrictEqual(before);
      expect((await taskRow(taskId)).title).toBe('Rückruf: Gutscheins');
    },
  );
});

describe('restart (M1)', () => {
  evidenceTest('the task survives a full API restart', async () => {
    const { taskId } = (await simulate(call())).json<{ taskId: string }>();
    await app.close();
    app = await build(SIMULATOR_TOKEN);
    const view = todayResponseSchema.parse((await today(await signIn(restaurantOwner))).json());
    expect(view.tasks.map((t) => t.id)).toContain(taskId);
  });
});
