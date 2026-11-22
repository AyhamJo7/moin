/**
 * Routed inbound webhook (P11.02.06, ROADMAP S1): an active number stores the call and the
 * disclosure it is issued, and answers with the disclosure ConversationRelay TwiML in the tenant's
 * name (INV-03 end to end); a quarantined number gets the neutral message and stores nothing; a
 * duplicate webhook is deduplicated by the database and speaks the words first issued (INV-11),
 * even after the number moved to another tenant (it then stores nothing); a failed write is
 * answered with speech (INV-19). The confirmation that the disclosure played is stored apart from
 * the issue, through the real token and relay. Fresh DB, synthetic numbers, the runtime role's pool.
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
  type SessionTokenStore,
} from '@moin/telephony';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { CONFIG } from '../../../config/config.module.ts';
import { loadConfig } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { FALLBACK_CALL_AGAIN } from '../application/fallback.ts';
import { noMeasurementSink, RelayConnection } from '../application/relay-connection.ts';
import { createRouteResolver, type RouteResolver } from '../../platform/route-resolver.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
import { TENANT_POOL } from '../../platform/tenant-pool.module.ts';
import { VoiceCalls } from '../../platform/voice-calls.ts';
import { DISCLOSURE_VERSION } from '../domain/disclosure.ts';
import { CLOCK, MEASUREMENT_SINK, SESSION_TOKENS } from '../voice.tokens.ts';
import { TwilioSignatureGuard } from './twilio-signature.guard.ts';
import { VoiceController } from './voice.controller.ts';

const AUTH_TOKEN = randomBytes(16).toString('hex');
const PUBLIC_ORIGIN = 'https://voice.example.de';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let resolver: RouteResolver;
let app: NestFastifyApplication;
let tokens: SessionTokenStore;
let calls: VoiceCalls;

let seq = 200;
function number(): string {
  seq += 1;
  return `+4930111223${String(seq).padStart(2, '0')}`;
}

beforeAll(async () => {
  database = await createTestDatabase('voice-inbound');
  admin = database.fixturePool();
  resolver = createRouteResolver(database.migrationUrl, 'voice-inbound-test');
  tokens = createInMemorySessionTokenStore();
  const config = loadConfig({
    SERVER_ROLE: 'voice',
    DATABASE_URL: 'postgres://moin_app:pw@localhost:5432/moin',
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    VOICE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [VoiceController],
    providers: [
      TwilioSignatureGuard,
      { provide: CONFIG, useValue: config },
      {
        provide: LOGGER,
        useValue: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
      { provide: SESSION_TOKENS, useValue: tokens },
      { provide: CLOCK, useValue: systemClock },
      { provide: MEASUREMENT_SINK, useValue: noMeasurementSink },
      { provide: ROUTE_RESOLVER, useValue: resolver },
      { provide: TENANT_POOL, useValue: database.pool() },
      VoiceCalls,
    ],
  }).compile();
  calls = moduleRef.get(VoiceCalls);

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await resolver.end();
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

function post(path: string, params: Record<string, string>) {
  const signature = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}${path}`, params);
  return app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    payload: new URLSearchParams(params).toString(),
  });
}

describe('routed inbound webhook (P11.02.06)', () => {
  evidenceTest('an active number answers with the disclosure TwiML', async () => {
    const { org: orgId, location } = await org(`w-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'active'],
    );
    const params = {
      CallSid: `CA${randomUUID().replace(/-/g, '').slice(0, 32)}`,
      From: '+4917612345678',
      To: e164,
      AccountSid: 'AC00000000000000000000000000000001',
    };
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<ConversationRelay');
    expect(response.body).toContain('welcomeGreetingInterruptible="none"');
    expect(response.body).toContain('KI-Assistent');
    const token = /<Parameter name="sessionToken" value="([^"]+)" \/>/u.exec(response.body)?.[1];
    expect(token).toBeDefined();
    expect(await consumeSessionToken(tokens, token ?? '', Date.now())).toMatchObject({
      ok: true,
    });
  });

  evidenceTest('a quarantined number gets the neutral message, no token', async () => {
    const { org: orgId, location } = await org(`hq-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'quarantined'],
    );
    const before = (tokens as ReturnType<typeof createInMemorySessionTokenStore>).size;
    const response = await post('/voice/inbound', {
      CallSid: `CA${randomUUID().replace(/-/g, '').slice(0, 32)}`,
      From: '+4917612345678',
      To: e164,
      AccountSid: 'AC00000000000000000000000000000001',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Diese Rufnummer ist derzeit nicht vergeben.');
    expect(response.body).not.toContain('<ConversationRelay');
    expect((tokens as ReturnType<typeof createInMemorySessionTokenStore>).size).toBe(before);
  });

  evidenceTest(
    'a duplicate CallSid stores one call and one disclosure, and the replay token is the tenant’s (INV-11)',
    async () => {
      const { org: orgId, location } = await org(`d-${randomUUID().slice(0, 8)}`);
      const e164 = await routed(orgId, location);
      const params = inboundParams(e164);
      const first = await post('/voice/inbound', params);
      const second = await post('/voice/inbound', params);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      // The same TwiML but for the single-use token each delivery mints.
      expect(withoutToken(second.body)).toBe(withoutToken(first.body));
      expect(await stored(params.CallSid)).toStrictEqual({ calls: 1, disclosures: 1 });
      // The replay's token opens a session for the same tenant, not a placeholder one.
      expect(await consumeSessionToken(tokens, tokenOf(second.body), Date.now())).toMatchObject({
        ok: true,
        tenantId: orgId,
      });
    },
  );

  evidenceTest('a routed call stores the call and the disclosure version as issued', async () => {
    const { org: orgId, location } = await org(`s-${randomUUID().slice(0, 8)}`);
    const e164 = await routed(orgId, location);
    const params = inboundParams(e164);
    expect((await post('/voice/inbound', params)).statusCode).toBe(200);
    const row = await admin.query<{
      organisation_id: string;
      from_number: string;
      to_number: string;
      disclosure_version: string;
    }>(
      `select c.organisation_id, c.from_number, c.to_number, d.disclosure_version
         from calls c join call_disclosures d on d.call_id = c.id
        where c.provider_call_sid = $1`,
      [params.CallSid],
    );
    expect(row.rows).toStrictEqual([
      {
        organisation_id: orgId,
        from_number: params.From,
        to_number: e164,
        disclosure_version: DISCLOSURE_VERSION,
      },
    ]);
  });

  evidenceTest(
    'the spoken name is the tenant’s: profile name first, then its own name',
    async () => {
      const { org: orgId, location } = await org(`n-${randomUUID().slice(0, 8)}`);
      const e164 = await routed(orgId, location);
      // No profile name yet: the organisation's registered name.
      const plain = await post('/voice/inbound', inboundParams(e164));
      expect(plain.body).toContain('digitalen Assistenten von Route Org.');
      await admin.query(
        `insert into business_profile (organisation_id, id, category, name)
       values ($1, $2, 'business_name', 'Pizzeria Sole')`,
        [orgId, randomUUID()],
      );
      const named = await post('/voice/inbound', inboundParams(e164));
      expect(named.body).toContain('digitalen Assistenten von Pizzeria Sole.');
      expect(named.body).not.toContain('Testanschluss');
    },
  );

  evidenceTest('a quarantined number stores no call', async () => {
    const { org: orgId, location } = await org(`q-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'quarantined'],
    );
    const params = inboundParams(e164);
    expect((await post('/voice/inbound', params)).statusCode).toBe(200);
    expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
  });
});

describe('a retried webhook (S1, INV-01, INV-03, INV-11)', () => {
  evidenceTest('after the number moved to another tenant, stores nothing anywhere', async () => {
    const first = await org(`r1-${randomUUID().slice(0, 8)}`);
    const second = await org(`r2-${randomUUID().slice(0, 8)}`);
    const e164 = await routed(first.org, first.location);
    const params = inboundParams(e164);
    expect((await post('/voice/inbound', params)).body).toContain('<ConversationRelay');
    await admin.query(
      'update number_routes set route_organisation_id = $2, location_id = $3 where e164 = $1',
      [e164, second.org, second.location],
    );
    const retry = await post('/voice/inbound', params);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).not.toContain('<ConversationRelay');
    expect(retry.body).toContain(FALLBACK_CALL_AGAIN);
    const owners = await admin.query<{ organisation_id: string }>(
      'select organisation_id from calls where provider_call_sid = $1',
      [params.CallSid],
    );
    expect(owners.rows).toStrictEqual([{ organisation_id: first.org }]);
  });

  evidenceTest('after a profile edit, speaks the name first issued', async () => {
    const { org: orgId, location } = await org(`pe-${randomUUID().slice(0, 8)}`);
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
    const { org: orgId, location } = await org(`rv-${randomUUID().slice(0, 8)}`);
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
    const { org: orgId, location } = await org(`au-${randomUUID().slice(0, 8)}`);
    const params = inboundParams(await routed(orgId, location));
    const answers = await Promise.all([
      post('/voice/inbound', params),
      post('/voice/inbound', params),
    ]);
    for (const answer of answers) expect(answer.body).toContain('<ConversationRelay');
    const audits = await admin.query<{ n: number; versions: unknown }>(
      `select count(*)::int as n, max(a.versions::text) as versions
         from audit_events a join calls c on c.id = a.target_id
        where c.provider_call_sid = $1 and a.operation = 'call.ingest'`,
      [params.CallSid],
    );
    expect(audits.rows[0]?.n).toBe(1);
    expect(String(audits.rows[0]?.versions)).toContain(DISCLOSURE_VERSION);
    expect(String(audits.rows[0]?.versions)).not.toContain(params.From.slice(1));
  });
});

describe('a webhook that cannot store the call (S1, INV-19)', () => {
  evidenceTest('is answered with the spoken call-again message and stores nothing', async () => {
    const { org: orgId, location } = await org(`f-${randomUUID().slice(0, 8)}`);
    const e164 = await routed(orgId, location);
    // Longer than any CallSid the database accepts: the write fails inside the transaction.
    const params = { ...inboundParams(e164), CallSid: `CA${'0'.repeat(120)}` };
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(FALLBACK_CALL_AGAIN);
    expect(response.body).not.toContain('<ConversationRelay');
    expect(await stored(params.CallSid)).toStrictEqual({ calls: 0, disclosures: 0 });
  });
});

describe('the disclosure confirmation, webhook to relay to database (S1, INV-03)', () => {
  const prompt = JSON.stringify({ type: 'prompt', voicePrompt: 'Hallo', last: true });

  async function issuedCall(): Promise<{ orgId: string; callSid: string; token: string }> {
    const { org: orgId, location } = await org(`p-${randomUUID().slice(0, 8)}`);
    const params = inboundParams(await routed(orgId, location));
    const response = await post('/voice/inbound', params);
    expect(response.statusCode).toBe(200);
    return { orgId, callSid: params.CallSid, token: tokenOf(response.body) };
  }

  function relay(): { connection: RelayConnection; closed: number[] } {
    const closed: number[] = [];
    const connection = new RelayConnection({
      io: { send: () => undefined, close: (code) => closed.push(code) },
      tokens,
      clock: systemClock,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      sink: noMeasurementSink,
      confirmations: calls,
    });
    return { connection, closed };
  }

  const setup = (callSid: string, token: string) =>
    JSON.stringify({
      type: 'setup',
      sessionId: 'VX1',
      callSid,
      customParameters: { sessionToken: token },
    });

  const evidence = (callSid: string) =>
    admin
      .query<{ confirmations: number; audits: number }>(
        `select
           (select count(*)::int from call_disclosure_confirmations k
              join calls c on c.id = k.call_id where c.provider_call_sid = $1) as confirmations,
           (select count(*)::int from audit_events a join calls c on c.id = a.target_id
             where c.provider_call_sid = $1 and a.operation = 'call.disclosure_confirmed')
             as audits`,
        [callSid],
      )
      .then((r) => r.rows[0]);

  evidenceTest('an issued call has no confirmation until a caller turn arrives', async () => {
    const { callSid, token } = await issuedCall();
    const { connection } = relay();
    await connection.onFrame(setup(callSid, token), Date.now());
    expect(connection.state).toBe('open');
    connection.onClose();
    await connection.settled();
    expect(await evidence(callSid)).toStrictEqual({ confirmations: 0, audits: 0 });
  });

  evidenceTest('the first caller turn stores one confirmation and one audit', async () => {
    const { callSid, token } = await issuedCall();
    const { connection } = relay();
    await connection.onFrame(setup(callSid, token), Date.now());
    await connection.onFrame(prompt, Date.now());
    await connection.settled();
    await connection.onFrame(prompt, Date.now());
    connection.onClose();
    await connection.settled();
    expect(await evidence(callSid)).toStrictEqual({ confirmations: 1, audits: 1 });
  });

  evidenceTest('the token of one call cannot confirm another call of the tenant', async () => {
    const one = await issuedCall();
    const { connection, closed } = relay();
    await connection.onFrame(setup(`CA${'f'.repeat(32)}`, one.token), Date.now());
    expect(closed).toHaveLength(1);
    await connection.onFrame(prompt, Date.now());
    await connection.settled();
    expect(await evidence(one.callSid)).toStrictEqual({ confirmations: 0, audits: 0 });
  });

  evidenceTest(
    'a confirmation for another tenant’s call, or an unknown one, is refused',
    async () => {
      const { callSid } = await issuedCall();
      const { org: other } = await org(`x-${randomUUID().slice(0, 8)}`);
      expect(await calls.confirm(other, callSid)).toBe(false);
      expect(await calls.confirm(other, 'CAunknown')).toBe(false);
      expect(await evidence(callSid)).toStrictEqual({ confirmations: 0, audits: 0 });
    },
  );
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
    CallSid: `CA${randomUUID().replace(/-/g, '').slice(0, 32)}`,
    From: '+4917612345678',
    To: e164,
    AccountSid: 'AC00000000000000000000000000000001',
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
