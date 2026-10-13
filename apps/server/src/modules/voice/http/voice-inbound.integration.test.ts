/**
 * Routed inbound webhook (P11.02.06): an active number answers with the
 * disclosure ConversationRelay TwiML (INV-03 end to end); a quarantined
 * number gets the neutral message; duplicate webhooks mint independent
 * single-use tokens without a duplicate row. Fresh DB, synthetic numbers.
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
import { noMeasurementSink } from '../application/relay-connection.ts';
import { createRouteResolver, type RouteResolver } from '../../platform/route-resolver.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
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
    ],
  }).compile();

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

  evidenceTest('duplicate webhooks mint independent tokens, no duplicate row', async () => {
    const { org: orgId, location } = await org(`d-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'active'],
    );
    // Same CallSid twice (Twilio retries): identical TwiML shape, distinct tokens.
    const params = {
      CallSid: `CA${randomUUID().replace(/-/g, '').slice(0, 32)}`,
      From: '+4917612345678',
      To: e164,
      AccountSid: 'AC00000000000000000000000000000001',
    };
    const first = await post('/voice/inbound', params);
    const second = await post('/voice/inbound', params);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const t1 = /<Parameter name="sessionToken" value="([^"]+)" \/>/u.exec(first.body)?.[1];
    const t2 = /<Parameter name="sessionToken" value="([^"]+)" \/>/u.exec(second.body)?.[1];
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1).not.toBe(t2);
    const routes = await admin.query<{ n: number }>(
      'select count(*)::int as n from number_routes where e164 = $1',
      [e164],
    );
    expect(routes.rows[0]?.n).toBe(1);
  });
});
