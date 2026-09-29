import { randomBytes } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '@moin/kernel';
import {
  computeSignature,
  consumeSessionToken,
  createInMemorySessionTokenStore,
  type SessionTokenStore,
} from '@moin/telephony';
import { CONFIG } from '../../../config/config.module.ts';
import { loadConfig, type Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { noMeasurementSink } from '../application/relay-connection.ts';
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

beforeEach(async () => {
  tokens = createInMemorySessionTokenStore();
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
  it('answers a correctly signed call with ConversationRelay TwiML', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const response = await post('/voice/inbound', INBOUND_PARAMS, signature);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toContain('<ConversationRelay');
    expect(response.body).toContain('url="wss://voice.example.de/voice/relay"');
    expect(response.body).toContain('action="https://voice.example.de/voice/session-end"');
  });

  // INV-03, end to end: not just that the builder can emit it, but that the endpoint does.
  it('includes the AI disclosure and makes it non-interruptible', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const response = await post('/voice/inbound', INBOUND_PARAMS, signature);

    expect(response.body).toContain('welcomeGreetingInterruptible="none"');
    expect(response.body).toContain('KI-Assistent');
    expect(response.body).toContain('nicht als Audio aufgezeichnet');
  });

  it('mints a session token that the relay handler will accept exactly once', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const response = await post('/voice/inbound', INBOUND_PARAMS, signature);

    const token = /<Parameter name="sessionToken" value="([^"]+)" \/>/u.exec(response.body)?.[1];
    expect(token).toBeDefined();
    const first = await consumeSessionToken(tokens, token ?? '', Date.now());
    expect(first.ok).toBe(true);
    const second = await consumeSessionToken(tokens, token ?? '', Date.now());
    expect(second).toStrictEqual({ ok: false, reason: 'unknown-or-used' });
  });

  it('issues a different token for every call', async () => {
    const signature = computeSignature(
      AUTH_TOKEN,
      `${PUBLIC_ORIGIN}/voice/inbound`,
      INBOUND_PARAMS,
    );
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const response = await post('/voice/inbound', INBOUND_PARAMS, signature);
      seen.add(/value="([^"]+)" \/>/u.exec(response.body)?.[1] ?? '');
    }
    expect(seen.size).toBe(3);
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
