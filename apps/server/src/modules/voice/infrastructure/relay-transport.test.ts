import { randomBytes } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '@moin/kernel';
import {
  createInMemorySessionTokenStore,
  issueSessionToken,
  type SessionTokenStore,
} from '@moin/telephony';
import { ConfigModule, CONFIG } from '../../../config/config.module.ts';
import { loadConfig, type Config } from '../../../config/env.ts';
import { LoggerModule, LOGGER } from '../../../observability/logger.module.ts';
import { MEASUREMENT_SCRIPT } from '../domain/measurement-script.ts';
import {
  CLOSE_UNAUTHENTICATED,
  RELAY_PATH,
  SESSION_TOKEN_PARAMETER,
} from '../domain/relay-contract.ts';
import { VoiceModule } from '../voice.module.ts';
import { CLOCK, SESSION_TOKENS } from '../voice.tokens.ts';

/**
 * A real socket against a real server.
 *
 * The rest of the voice tests deliberately avoid one, but this file exists to answer the question
 * they cannot: whether the WebSocket route is registered at all. It is registered from
 * `onModuleInit`, and Fastify closes plugin registration when the server becomes ready — a
 * mistake there produces a module that passes every unit test and a 404 on every call.
 */

const CONFIG_VALUE: Config = loadConfig({
  SERVER_ROLE: 'voice',
  DATABASE_URL: 'postgres://moin_app:pw@localhost:5432/moin',
  TWILIO_AUTH_TOKEN: randomBytes(16).toString('hex'),
  VOICE_PUBLIC_ORIGIN: 'https://voice.example.de',
  VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
});

let app: NestFastifyApplication;
let tokens: SessionTokenStore;
let address: string;

beforeEach(async () => {
  tokens = createInMemorySessionTokenStore();
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(CONFIG_VALUE), LoggerModule, VoiceModule],
  })
    .overrideProvider(CONFIG)
    .useValue(CONFIG_VALUE)
    .overrideProvider(LOGGER)
    .useValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    .overrideProvider(SESSION_TOKENS)
    .useValue(tokens)
    .overrideProvider(CLOCK)
    .useValue(systemClock)
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.listen({ port: 0, host: '127.0.0.1' });
  address = (await app.getUrl()).replace('http://', 'ws://');
});

afterEach(async () => {
  await app.close();
});

/** Collects frames until `predicate` is satisfied or the socket closes. */
function connect(): {
  socket: WebSocket;
  open: Promise<void>;
  frames: string[];
  closed: Promise<CloseEvent>;
} {
  const socket = new WebSocket(`${address}${RELAY_PATH}`);
  const frames: string[] = [];
  socket.addEventListener('message', (event: MessageEvent) => {
    frames.push(String(event.data));
  });
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('socket errored before opening'));
    });
  });
  const closed = new Promise<CloseEvent>((resolve) => {
    socket.addEventListener('close', (event: CloseEvent) => {
      resolve(event);
    });
  });
  return { socket, open, frames, closed };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the socket');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('the relay WebSocket endpoint', () => {
  it('is reachable and answers an authenticated setup with the first ask', async () => {
    const issued = await issueSessionToken(
      tokens,
      'a1b2c3d4-0000-4000-8000-000000000001',
      Date.now(),
    );
    const client = connect();
    await client.open;

    client.socket.send(
      JSON.stringify({
        type: 'setup',
        sessionId: 'VX1',
        callSid: 'CA1',
        customParameters: { [SESSION_TOKEN_PARAMETER]: issued.token },
      }),
    );

    await waitFor(() => client.frames.length > 0);
    expect(JSON.parse(client.frames[0] ?? '{}')).toMatchObject({
      type: 'text',
      token: MEASUREMENT_SCRIPT[0]?.ask,
    });
    client.socket.close();
  });

  it('closes a socket that presents no token', async () => {
    const client = connect();
    await client.open;
    client.socket.send(JSON.stringify({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }));

    const event = await client.closed;
    expect(event.code).toBe(CLOSE_UNAUTHENTICATED);
    expect(client.frames).toStrictEqual([]);
  });
});
