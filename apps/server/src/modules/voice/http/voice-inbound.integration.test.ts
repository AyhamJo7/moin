/**
 * Routed inbound webhook (P11.02.06, ROADMAP S1), against a fresh database with the runtime role
 * (`moin_app`) for both the routing function and the tenant writes.
 *
 * - An active number stores the call and the disclosure it is issued, and answers with the
 *   disclosure ConversationRelay TwiML in the tenant's name (INV-03 end to end).
 * - Quarantined, unrouted and genuine provider traffic get the neutral message and store nothing.
 * - A duplicate webhook is deduplicated by the database and speaks the words first issued
 *   (INV-11); a retry whose number no longer routes to the first decision's tenant stores
 *   nothing anywhere (INV-01).
 * - A database that cannot be reached is answered with speech (INV-19).
 * - One relay session per call, whatever the number of deliveries.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, vi } from 'vitest';
import { systemClock } from '@moin/kernel';
import {
  computeSignature,
  consumeSessionToken,
  createInMemorySessionTokenStore,
  UNASSIGNED_MESSAGE,
  type SessionTokenStore,
} from '@moin/telephony';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { CONFIG } from '../../../config/config.module.ts';
import { loadConfig } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { FALLBACK_CALL_AGAIN } from '../application/fallback.ts';
import { SYNTHETIC_ACCOUNT_SID } from '../application/inbound-route.ts';
import { noMeasurementSink, RelayConnection } from '../application/relay-connection.ts';
import { createRouteResolver, type RouteResolver } from '../../platform/route-resolver.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
import { createTenantPool, TENANT_POOL } from '../../platform/tenant-pool.module.ts';
import { VoiceCalls } from '../../platform/voice-calls.ts';
import { DISCLOSURE_VERSION } from '../domain/disclosure.ts';
import { CLOCK, MEASUREMENT_SINK, SESSION_TOKENS } from '../voice.tokens.ts';
import { TwilioSignatureGuard } from './twilio-signature.guard.ts';
import { VoiceController } from './voice.controller.ts';

const AUTH_TOKEN = randomBytes(16).toString('hex');
const PUBLIC_ORIGIN = 'https://voice.example.de';
const CALLER = '+4917612345678';
/** Long enough for the delivery to reach the route row, well under the resolver's timeout. */
const REASSIGNMENT_HOLD_MS = 300;

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let resolver: RouteResolver;
let app: NestFastifyApplication;
let tokens: SessionTokenStore;
/** A database name that does not exist: every connection to it fails, as in an outage. */
let unreachableUrl: string;
const closers: (() => Promise<void>)[] = [];

let seq = 200;
function number(): string {
  seq += 1;
  return `+4930111223${String(seq).padStart(2, '0')}`;
}

type TenantPool = NonNullable<ReturnType<typeof createTenantPool>>;

const config = (databaseUrl = 'postgres://moin_app:pw@localhost:5432/moin') =>
  loadConfig({
    SERVER_ROLE: 'voice',
    DATABASE_URL: databaseUrl,
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    VOICE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
  });

async function voiceApp(deps: {
  readonly tokens: SessionTokenStore;
  readonly resolver: RouteResolver;
  readonly tenantPool: TenantPool;
}): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [VoiceController],
    providers: [
      TwilioSignatureGuard,
      { provide: CONFIG, useValue: config() },
      {
        provide: LOGGER,
        useValue: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
      { provide: SESSION_TOKENS, useValue: deps.tokens },
      { provide: CLOCK, useValue: systemClock },
      { provide: MEASUREMENT_SINK, useValue: noMeasurementSink },
      { provide: ROUTE_RESOLVER, useValue: deps.resolver },
      { provide: TENANT_POOL, useValue: deps.tenantPool },
      VoiceCalls,
    ],
  }).compile();
  const created = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await created.init();
  await created.getHttpAdapter().getInstance().ready();
  return created;
}

beforeAll(async () => {
  database = await createTestDatabase('voice-inbound');
  admin = database.fixturePool();
  const absent = new URL(database.appUrl);
  absent.pathname = '/moin_voice_inbound_absent';
  unreachableUrl = absent.toString();
  // The runtime role, as production runs it: the routing function must work for moin_app.
  resolver = createRouteResolver(database.appUrl, 'voice-inbound-test');
  tokens = createInMemorySessionTokenStore();
  app = await voiceApp({ tokens, resolver, tenantPool: database.pool() });
}, 60_000);

afterAll(async () => {
  await app.close();
  await resolver.end();
  for (const close of closers) await close();
  await database.drop();
});

async function org(slug: string): Promise<{ org: string; location: string }> {
  const orgId = randomUUID();
  const locationId = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    orgId,
    slug,
    'Route Org',
  ]);
  await admin.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
    orgId,
    locationId,
    'Standort',
  ]);
  return { org: orgId, location: locationId };
}

function post(path: string, params: Record<string, string>, target = app) {
  const signature = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}${path}`, params);
  return target.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    payload: new URLSearchParams(params).toString(),
  });
}

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

describe('routed inbound webhook (P11.02.06)', () => {
  evidenceTest('an active number answers with the disclosure TwiML', async () => {
    const { org: orgId, location } = await org(slug('w'));
    const params = inboundParams(await routed(orgId, location));
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<ConversationRelay');
    expect(response.body).toContain('welcomeGreetingInterruptible="none"');
    expect(response.body).toContain('KI-Assistent');
    expect(await consumeSessionToken(tokens, tokenOf(response.body), Date.now())).toMatchObject({
      ok: true,
      tenantId: orgId,
      callSid: params.CallSid,
    });
  });

  evidenceTest('a quarantined number gets the neutral message and stores nothing', async () => {
    const { org: orgId, location } = await org(slug('q'));
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'quarantined'],
    );
    const before = (tokens as ReturnType<typeof createInMemorySessionTokenStore>).size;
    const params = inboundParams(e164);
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(UNASSIGNED_MESSAGE);
    expect(response.body).not.toContain('<ConversationRelay');
    expect((tokens as ReturnType<typeof createInMemorySessionTokenStore>).size).toBe(before);
    expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
  });

  evidenceTest('a routed call stores the call and the disclosure as issued', async () => {
    const { org: orgId, location } = await org(slug('s'));
    const e164 = await routed(orgId, location);
    const params = inboundParams(e164);
    expect((await post('/voice/inbound', params)).statusCode).toBe(200);
    const row = await admin.query(
      `select c.organisation_id, c.from_number, c.to_number, d.disclosure_version, d.business_name
         from calls c join call_disclosures d on d.call_id = c.id
        where c.provider_call_sid = $1`,
      [params.CallSid],
    );
    expect(row.rows).toStrictEqual([
      {
        organisation_id: orgId,
        from_number: CALLER,
        to_number: e164,
        disclosure_version: DISCLOSURE_VERSION,
        business_name: 'Route Org',
      },
    ]);
  });

  evidenceTest(
    'the spoken name is the tenant’s: profile name first, then its own name',
    async () => {
      const { org: orgId, location } = await org(slug('n'));
      const e164 = await routed(orgId, location);
      const plain = await post('/voice/inbound', inboundParams(e164));
      expect(plain.body).toContain('digitalen Assistenten von Route Org.');
      await admin.query(
        `insert into business_profile (organisation_id, id, category, name)
         values ($1, $2, 'business_name', 'Pizzeria Sole')`,
        [orgId, randomUUID()],
      );
      const named = await post('/voice/inbound', inboundParams(e164));
      expect(named.body).toContain('digitalen Assistenten von Pizzeria Sole.');
    },
  );

  evidenceTest('only a presented E.164 caller id is stored', async () => {
    const { org: orgId, location } = await org(slug('c'));
    const e164 = await routed(orgId, location);
    const cases: [string, string | null][] = [
      ['anonymous', null],
      ['client:alice', null],
      ['+49900123456', null],
      [e164, null],
      [CALLER, CALLER],
    ];
    for (const [from, kept] of cases) {
      const params = { ...inboundParams(e164), From: from };
      expect((await post('/voice/inbound', params)).body, from).toContain('<ConversationRelay');
      const row = await admin.query<{ from_number: string | null }>(
        'select from_number from calls where provider_call_sid = $1',
        [params.CallSid],
      );
      expect(row.rows, from).toStrictEqual([{ from_number: kept }]);
    }
  });

  evidenceTest('a repeated field is read as the signature read it: the last value', async () => {
    const { org: orgId, location } = await org(slug('rp'));
    const e164 = await routed(orgId, location);
    const params = inboundParams(e164);
    const body = new URLSearchParams(params);
    body.append('From', 'anonymous');
    const response = await app.inject({
      method: 'POST',
      url: '/voice/inbound',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}/voice/inbound`, {
          ...params,
          From: 'anonymous',
        }),
      },
      payload: body.toString(),
    });
    expect(response.body).toContain('<ConversationRelay');
    const row = await admin.query<{ from_number: string | null }>(
      'select from_number from calls where provider_call_sid = $1',
      [params.CallSid],
    );
    expect(row.rows).toStrictEqual([{ from_number: null }]);
  });
});

describe('traffic this release does not serve stores nothing (S1)', () => {
  evidenceTest('genuine provider traffic, signed and routed, writes nothing', async () => {
    const { org: orgId, location } = await org(slug('g'));
    const params = {
      ...inboundParams(await routed(orgId, location)),
      AccountSid: `AC${randomBytes(16).toString('hex')}`,
    };
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(UNASSIGNED_MESSAGE);
    expect(response.body).not.toContain('<ConversationRelay');
    expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
    expect(await binding(params.CallSid)).toStrictEqual([]);
  });

  evidenceTest('a body whose CallSid is not a provider CallSid writes nothing', async () => {
    const { org: orgId, location } = await org(slug('m'));
    const params = { ...inboundParams(await routed(orgId, location)), CallSid: 'CA-not-a-sid' };
    const response = await post('/voice/inbound', params);
    expect(response.body).toContain(UNASSIGNED_MESSAGE);
    expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
  });
});

describe('a retried webhook (S1, INV-01, INV-03, INV-11)', () => {
  evidenceTest(
    'a duplicate CallSid stores one call and one disclosure, and speaks the same words',
    async () => {
      const { org: orgId, location } = await org(slug('d'));
      const params = inboundParams(await routed(orgId, location));
      const first = await post('/voice/inbound', params);
      const second = await post('/voice/inbound', params);
      expect(withoutToken(second.body)).toBe(withoutToken(first.body));
      expect(await stored(params.CallSid)).toStrictEqual({ calls: 1, disclosures: 1 });
    },
  );

  evidenceTest('after the number moved to another tenant, stores nothing anywhere', async () => {
    const first = await org(slug('r1'));
    const second = await org(slug('r2'));
    const e164 = await routed(first.org, first.location);
    const params = inboundParams(e164);
    expect((await post('/voice/inbound', params)).body).toContain('<ConversationRelay');
    await admin.query(
      'update number_routes set route_organisation_id = $2, location_id = $3 where e164 = $1',
      [e164, second.org, second.location],
    );
    const retry = await post('/voice/inbound', params);
    expect(retry.body).toContain(UNASSIGNED_MESSAGE);
    expect(retry.body).not.toContain('<ConversationRelay');
    expect(await owners(params.CallSid)).toStrictEqual([first.org]);
  });

  evidenceTest(
    'answered neutrally first, then the number was activated: still stores nothing',
    async () => {
      const { org: orgId, location } = await org(slug('a'));
      const e164 = number();
      const params = inboundParams(e164);
      expect((await post('/voice/inbound', params)).body).toContain(UNASSIGNED_MESSAGE);
      await admin.query(
        'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
        [e164, orgId, location, 'active'],
      );
      const retry = await post('/voice/inbound', params);
      expect(retry.body).toContain(UNASSIGNED_MESSAGE);
      expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
      expect(await binding(params.CallSid)).toStrictEqual([{ organisation: null }]);
    },
  );

  evidenceTest(
    'deliveries racing a reassignment store the call under its one binding, or not at all',
    async () => {
      for (let round = 0; round < 5; round += 1) {
        const first = await org(slug('cr1'));
        const second = await org(slug('cr2'));
        const e164 = await routed(first.org, first.location);
        const params = inboundParams(e164);
        await Promise.all([
          post('/voice/inbound', params),
          admin.query(
            'update number_routes set route_organisation_id = $2, location_id = $3 where e164 = $1',
            [e164, second.org, second.location],
          ),
          post('/voice/inbound', params),
        ]);
        const bound = await binding(params.CallSid);
        expect(bound).toHaveLength(1);
        const stores = await owners(params.CallSid);
        expect(stores.length).toBeLessThanOrEqual(1);
        if (stores.length === 1) expect(stores).toStrictEqual([bound[0]?.organisation]);
      }
    },
  );

  // The route row is read FOR SHARE: a delivery that arrives while a reassignment is uncommitted
  // waits for it and decides on the committed route, never on the row being replaced.
  evidenceTest('a delivery during an uncommitted reassignment decides after it', async () => {
    const first = await org(slug('lk1'));
    const second = await org(slug('lk2'));
    const e164 = await routed(first.org, first.location);
    const params = inboundParams(e164);
    const reassigning = await admin.connect();
    try {
      await reassigning.query('begin');
      await reassigning.query(
        'update number_routes set route_organisation_id = $2, location_id = $3 where e164 = $1',
        [e164, second.org, second.location],
      );
      const delivery = post('/voice/inbound', params);
      await new Promise((resolve) => setTimeout(resolve, REASSIGNMENT_HOLD_MS));
      await reassigning.query('commit');
      expect((await delivery).body).toContain('<ConversationRelay');
    } finally {
      reassigning.release();
    }
    expect(await binding(params.CallSid)).toStrictEqual([{ organisation: second.org }]);
    expect(await owners(params.CallSid)).toStrictEqual([second.org]);
  });

  evidenceTest('after a profile edit, speaks the name first issued', async () => {
    const { org: orgId, location } = await org(slug('pe'));
    const params = inboundParams(await routed(orgId, location));
    expect((await post('/voice/inbound', params)).body).toContain('von Route Org.');
    await admin.query(
      `insert into business_profile (organisation_id, id, category, name)
       values ($1, $2, 'business_name', 'Pizzeria Sole')`,
      [orgId, randomUUID()],
    );
    const retry = await post('/voice/inbound', params);
    expect(retry.body).toContain('von Route Org.');
    expect(retry.body).not.toContain('Pizzeria Sole');
  });

  evidenceTest('of a call issued a retired disclosure is refused, not re-worded', async () => {
    const { org: orgId, location } = await org(slug('rv'));
    const params = inboundParams(await routed(orgId, location));
    expect((await post('/voice/inbound', params)).statusCode).toBe(200);
    await admin.query(
      `update call_disclosures d set disclosure_version = 'de-0-retired'
         from calls c where c.id = d.call_id and c.provider_call_sid = $1`,
      [params.CallSid],
    );
    const retry = await post('/voice/inbound', params);
    expect(retry.body).not.toContain('<ConversationRelay');
    expect(retry.body).toContain(FALLBACK_CALL_AGAIN);
  });

  evidenceTest('delivered twice at once audits the call creation once (INV-10)', async () => {
    const { org: orgId, location } = await org(slug('au'));
    const params = inboundParams(await routed(orgId, location));
    const answers = await Promise.all([
      post('/voice/inbound', params),
      post('/voice/inbound', params),
    ]);
    for (const answer of answers) expect(answer.body).toContain('<ConversationRelay');
    const audits = await admin.query<{ n: number; versions: string }>(
      `select count(*)::int as n, max(a.versions::text) as versions
         from audit_events a join calls c on c.id = a.target_id
        where c.provider_call_sid = $1 and a.operation = 'call.ingest'`,
      [params.CallSid],
    );
    expect(audits.rows[0]?.n).toBe(1);
    expect(audits.rows[0]?.versions).toContain(DISCLOSURE_VERSION);
    expect(audits.rows[0]?.versions).not.toContain(CALLER.slice(1));
  });

  evidenceTest('two deliveries mint two tokens, and only one opens a session', async () => {
    const { org: orgId, location } = await org(slug('ts'));
    const params = inboundParams(await routed(orgId, location));
    const answers = await Promise.all([
      post('/voice/inbound', params),
      post('/voice/inbound', params),
    ]);
    const sessions = await Promise.all(
      answers.map(async (answer) => {
        const connection = new RelayConnection({
          io: { send: () => undefined, close: () => undefined },
          tokens,
          clock: systemClock,
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
          sink: noMeasurementSink,
        });
        await connection.onFrame(
          JSON.stringify({
            type: 'setup',
            sessionId: 'VX1',
            callSid: params.CallSid,
            customParameters: { sessionToken: tokenOf(answer.body) },
          }),
          Date.now(),
        );
        return connection.state;
      }),
    );
    expect(sessions.toSorted()).toStrictEqual(['closed', 'open']);
  });
});

describe('a database that cannot be reached (S1, INV-19)', () => {
  async function outageApp(which: 'routing' | 'tenant'): Promise<NestFastifyApplication> {
    const deadPool = createTenantPool(config(unreachableUrl));
    if (deadPool === null) throw new Error('the voice role has a tenant pool');
    const deadResolver = createRouteResolver(unreachableUrl, 'voice-inbound-outage');
    const created = await voiceApp({
      tokens: createInMemorySessionTokenStore(),
      resolver: which === 'routing' ? deadResolver : resolver,
      tenantPool: which === 'tenant' ? deadPool : database.pool(),
    });
    closers.push(
      () => created.close(),
      () => deadResolver.end(),
      () => deadPool.end(),
    );
    return created;
  }

  for (const which of ['routing', 'tenant'] as const) {
    evidenceTest(`an unreachable ${which} database is answered with speech`, async () => {
      const { org: orgId, location } = await org(slug(`o${which}`));
      const params = inboundParams(await routed(orgId, location));
      const response = await post('/voice/inbound', params, await outageApp(which));
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(FALLBACK_CALL_AGAIN);
      expect(response.body).not.toContain('<ConversationRelay');
      expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
    });
  }
});

describe('the routing function’s privileges (S1, INV-01)', () => {
  evidenceTest('moin_app executes route_call but cannot read call_routes directly', async () => {
    await expect(database.pool().query('select * from call_routes')).rejects.toMatchObject({
      code: '42501',
    });
    const grants = await admin.query<{ role: string; can: boolean }>(
      `select r.rolname as role,
              has_function_privilege(r.oid, 'app.route_call(text, text)', 'EXECUTE') as can
         from pg_roles r
        where r.rolname in ('moin_app', 'moin_identity', 'moin_provisioner', 'moin_dispatcher',
                            'moin_support_ro', 'moin_reporting')
        order by r.rolname`,
    );
    expect(grants.rows.filter((row) => row.can).map((row) => row.role)).toStrictEqual(['moin_app']);
  });
});

async function routed(orgId: string, location: string): Promise<string> {
  const e164 = number();
  await admin.query(
    'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
    [e164, orgId, location, 'active'],
  );
  return e164;
}

function inboundParams(e164: string) {
  return {
    CallSid: `CA${randomBytes(16).toString('hex')}`,
    From: CALLER,
    To: e164,
    AccountSid: SYNTHETIC_ACCOUNT_SID,
  };
}

const TOKEN = /<Parameter name="sessionToken" value="([^"]+)" \/>/u;

function tokenOf(body: string): string {
  const token = TOKEN.exec(body)?.[1];
  if (token === undefined) throw new Error('no session token in the TwiML');
  return token;
}

function withoutToken(body: string): string {
  return body.replace(TOKEN, '<Parameter name="sessionToken" />');
}

async function stored(callSid: string): Promise<{ calls: number; disclosures: number }> {
  const result = await admin.query<{ calls: number; disclosures: number }>(
    `select (select count(*)::int from calls where provider_call_sid = $1) as calls,
            (select count(*)::int from call_disclosures d join calls c on c.id = d.call_id
              where c.provider_call_sid = $1) as disclosures`,
    [callSid],
  );
  return result.rows[0] ?? { calls: -1, disclosures: -1 };
}

async function owners(callSid: string): Promise<string[]> {
  const result = await admin.query<{ organisation_id: string }>(
    'select organisation_id from calls where provider_call_sid = $1',
    [callSid],
  );
  return result.rows.map((row) => row.organisation_id);
}

async function binding(callSid: string): Promise<{ organisation: string | null }[]> {
  const result = await admin.query<{ organisation: string | null }>(
    'select route_organisation_id as organisation from call_routes where provider_call_sid = $1',
    [callSid],
  );
  return result.rows;
}
