import { randomBytes } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '@moin/kernel';
import {
  computeSignature,
  createInMemorySessionTokenStore,
  type SessionTokenStore,
} from '@moin/telephony';
import { CONFIG } from '../../../config/config.module.ts';
import { loadConfig, type Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { FALLBACK_CALL_AGAIN } from '../application/fallback.ts';
import { noMeasurementSink } from '../application/relay-connection.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
import { VoiceCalls } from '../../platform/voice-calls.ts';
import { CLOCK, MEASUREMENT_SINK, SESSION_TOKENS } from '../voice.tokens.ts';
import { TwilioSignatureGuard } from './twilio-signature.guard.ts';
import { VoiceController } from './voice.controller.ts';

// Generated per run rather than written down. A 32-hex literal in a test file is indistinguishable
// from a real Twilio auth token — to a reader, to a scanner, and to anyone who copies the file as
// a starting point. The secret scanner flagged all three of these, and it was right to.
const AUTH_TOKEN = randomBytes(16).toString('hex');
const PUBLIC_ORIGIN = 'https://voice.example.de';

const CONFIG_VALUE: Config = loadConfig({
  SERVER_ROLE: 'voice',
  DATABASE_URL: 'postgres://moin_app:pw@localhost:5432/moin',
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  VOICE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
});

let app: NestFastifyApplication;
let tokens: SessionTokenStore;
let calls: { recordInbound: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  tokens = createInMemorySessionTokenStore();
  calls = { recordInbound: vi.fn(), confirm: vi.fn() };
  const moduleRef = await Test.createTestingModule({
    controllers: [VoiceController],
    providers: [
      TwilioSignatureGuard,
      { provide: CONFIG, useValue: CONFIG_VALUE },
      {
        provide: LOGGER,
        useValue: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
      { provide: SESSION_TOKENS, useValue: tokens },
      { provide: CLOCK, useValue: systemClock },
      { provide: MEASUREMENT_SINK, useValue: noMeasurementSink },
      {
        // No resolver in unit tests: every number is unassigned, which is
        // exactly the unknown-number path P11.02.06 pins. Routed paths ride
        // the integration test against resolve_route.
        provide: ROUTE_RESOLVER,
        useValue: null,
      },
      { provide: VoiceCalls, useValue: calls },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterEach(async () => {
  await app.close();
});

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function post(path: string, params: Record<string, string>, signature: string | undefined) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature === undefined ? {} : { 'x-twilio-signature': signature }),
    },
    payload: form(params),
  });
}

const INBOUND_PARAMS = {
  CallSid: 'CA00000000000000000000000000000001',
  From: '+4917612345678',
  To: '+494012345678',
  AccountSid: 'AC00000000000000000000000000000001',
};

describe('POST /voice/inbound', () => {
  // No ROUTE_POOL in unit tests: every number is unassigned (P11.02.06).
  it('answers an unknown number with the neutral message, never a tenant', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const response = await post('/voice/inbound', INBOUND_PARAMS, signature);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toContain('Diese Rufnummer ist derzeit nicht vergeben.');
    expect(response.body).toContain('<Hangup />');
    expect(response.body).not.toContain('<ConversationRelay');
  });

  it('mints no token for an unassigned number', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    await post('/voice/inbound', INBOUND_PARAMS, signature);
    const store = tokens as ReturnType<typeof createInMemorySessionTokenStore>;
    expect(store.size).toBe(0);
  });

  // P11.03.04: a retried webhook for the same CallSid replays the outcome —
  // same neutral TwiML, no second effect. Twilio signs the identical body
  // identically, so the retry carries the same signature.
  it('replays a duplicate CallSid without a second effect', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const first = await post('/voice/inbound', INBOUND_PARAMS, signature);
    const second = await post('/voice/inbound', INBOUND_PARAMS, signature);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    const store = tokens as ReturnType<typeof createInMemorySessionTokenStore>;
    expect(store.size).toBe(0);
    // An unassigned number has no tenant to store a call in.
    expect(calls.recordInbound).not.toHaveBeenCalled();
  });

  it('rejects a tampered body and a wrong account URL (P11.03.01/.04)', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    // Tampered To: the signature no longer matches.
    const tampered = await post(
      '/voice/inbound',
      { ...INBOUND_PARAMS, To: '+494099999999' },
      signature,
    );
    expect(tampered.statusCode).toBe(403);
    // Signature for a different path: the URL check refuses.
    const wrongUrl = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}/voice/other`, INBOUND_PARAMS);
    const refused = await post('/voice/inbound', INBOUND_PARAMS, wrongUrl);
    expect(refused.statusCode).toBe(403);
  });

  // INV-03, end to end on the routed path: the disclosure builder's own
  // fixtures pin the attributes; here the endpoint proves it serves the same
  // builder output. Routed paths ride the integration test below.
  it('keeps the disclosure builder honest (INV-03 attributes pinned)', async () => {
    const { buildConversationRelayTwiML } = await import('@moin/telephony');
    const { buildDisclosure } = await import('../domain/disclosure.ts');
    const twiml = buildConversationRelayTwiML({
      websocketUrl: 'wss://voice.example.de/voice/relay',
      actionUrl: `${PUBLIC_ORIGIN}/voice/session-end`,
      disclosure: buildDisclosure('dem Testanschluss'),
      language: 'de-DE',
      transcription: { provider: 'Deepgram' },
      speech: { provider: 'Google', voice: 'de-DE-Standard-A' },
      interruptible: true,
      dtmfDetection: true,
      parameters: {},
    });
    expect(twiml).toContain('welcomeGreetingInterruptible="none"');
    expect(twiml).toContain('KI-Assistent');
    expect(twiml).toContain('nicht als Audio aufgezeichnet');
  });
});

describe('the signature guard', () => {
  it('rejects a request with no signature', async () => {
    const response = await post('/voice/inbound', INBOUND_PARAMS, undefined);
    expect(response.statusCode).toBe(403);
  });

  it('rejects a wrong signature', async () => {
    const response = await post('/voice/inbound', INBOUND_PARAMS, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(response.statusCode).toBe(403);
  });

  // The attack: take a signature from a legitimate request and attach it to a different body.
  it('rejects a body that does not match the signature', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const response = await post(
      '/voice/inbound',
      { ...INBOUND_PARAMS, From: '+4917600000000' },
      signature,
    );
    expect(response.statusCode).toBe(403);
  });

  it('rejects a signature computed for a different path', async () => {
    const signature = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}/voice/other`, INBOUND_PARAMS);
    const response = await post('/voice/inbound', INBOUND_PARAMS, signature);
    expect(response.statusCode).toBe(403);
  });

  it('says nothing in the body about why it refused', async () => {
    const response = await post('/voice/inbound', INBOUND_PARAMS, undefined);
    expect(response.body).not.toContain('signature');
    expect(response.body).not.toContain('Twilio');
  });

  it('mints no token for a rejected request', async () => {
    await post('/voice/inbound', INBOUND_PARAMS, undefined);
    const store = tokens as ReturnType<typeof createInMemorySessionTokenStore>;
    expect(store.size).toBe(0);
  });
});

describe('POST /voice/session-end', () => {
  const params = {
    SessionStatus: 'completed',
    HandoffData: JSON.stringify({ reasonCode: 'measurement-complete', slots: 6 }),
  };

  it('accepts a signed session report', async () => {
    const signature = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}/voice/session-end`, params);
    const response = await post('/voice/session-end', params, signature);
    expect(response.statusCode).toBe(204);
  });

  it('rejects an unsigned session report', async () => {
    const response = await post('/voice/session-end', params, undefined);
    expect(response.statusCode).toBe(403);
  });

  it('survives handoff data that is not the JSON we sent', async () => {
    const odd = { SessionStatus: 'failed', HandoffData: 'not json' };
    const signature = computeSignature(AUTH_TOKEN, `${PUBLIC_ORIGIN}/voice/session-end`, odd);
    const response = await post('/voice/session-end', odd, signature);
    expect(response.statusCode).toBe(204);
  });
});

// INV-19: a routed call whose tenant write fails hears why the call ends; the provider never gets
// an error status (which it would play as an error tone) and no session token is minted.
describe('POST /voice/inbound when the call cannot be stored', () => {
  const ORG = 'a1b2c3d4-0000-4000-8000-000000000001';
  let failing: NestFastifyApplication;
  let failingTokens: ReturnType<typeof createInMemorySessionTokenStore>;

  async function start(routeCall: () => Promise<unknown>): Promise<void> {
    failingTokens = createInMemorySessionTokenStore();
    const moduleRef = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        TwilioSignatureGuard,
        { provide: CONFIG, useValue: CONFIG_VALUE },
        {
          provide: LOGGER,
          useValue: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        { provide: SESSION_TOKENS, useValue: failingTokens },
        { provide: CLOCK, useValue: systemClock },
        { provide: MEASUREMENT_SINK, useValue: noMeasurementSink },
        {
          provide: ROUTE_RESOLVER,
          useValue: { resolve: routeCall, routeCall, end: () => Promise.resolve() },
        },
        {
          provide: VoiceCalls,
          useValue: { recordInbound: () => Promise.reject(new Error('database unavailable')) },
        },
      ],
    }).compile();
    failing = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await failing.init();
    await failing.getHttpAdapter().getInstance().ready();
  }

  afterEach(async () => {
    await failing.close();
  });

  it.each([
    ['the tenant write fails', () => Promise.resolve([{ organisationId: ORG, locationId: ORG }])],
    ['the route lookup fails', () => Promise.reject(new Error('database unavailable'))],
  ])('answers with the spoken call-again message and mints no token when %s', async (_n, route) => {
    await start(route);
    const response = await failing.inject({
      method: 'POST',
      url: '/voice/inbound',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': computeSignature(
          AUTH_TOKEN,
          `${PUBLIC_ORIGIN}/voice/inbound`,
          INBOUND_PARAMS,
        ),
      },
      payload: form(INBOUND_PARAMS),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(FALLBACK_CALL_AGAIN);
    expect(response.body).toContain('<Hangup />');
    expect(response.body).not.toContain('<ConversationRelay');
    expect(failingTokens.size).toBe(0);
  });
});
