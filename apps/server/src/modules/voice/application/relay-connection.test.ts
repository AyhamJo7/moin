import { fixedClock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import {
  createInMemorySessionTokenStore,
  issueSessionToken,
  SESSION_TOKEN_TTL_MS,
  type SessionTokenStore,
} from '@moin/telephony';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_NORMAL,
  CLOSE_SETUP_TIMEOUT,
  CLOSE_UNAUTHENTICATED,
  SESSION_TOKEN_PARAMETER,
} from '../domain/relay-contract.ts';
import { MEASUREMENT_SCRIPT } from '../domain/measurement-script.ts';
import { RelayConnection, type MeasurementSink } from './relay-connection.ts';
import type { SessionSummary } from './relay-session.ts';

const T0 = Date.UTC(2026, 8, 29, 9, 0, 0);
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function harness(store: SessionTokenStore = createInMemorySessionTokenStore()) {
  const sent: string[] = [];
  const closed: number[] = [];
  const recorded: SessionSummary[] = [];
  const clock = fixedClock(new Date(T0));
  const sink: MeasurementSink = {
    record(summary) {
      recorded.push(summary);
    },
  };
  const connection = new RelayConnection({
    io: {
      send: (frame) => sent.push(frame),
      close: (code) => closed.push(code),
    },
    tokens: store,
    clock,
    logger: fakeLogger(),
    sink,
  });
  return { connection, sent, closed, recorded, clock, store };
}

function setupFrame(token: string | undefined): string {
  return JSON.stringify({
    type: 'setup',
    sessionId: 'VX1',
    callSid: 'CA1',
    ...(token === undefined ? {} : { customParameters: { [SESSION_TOKEN_PARAMETER]: token } }),
  });
}

describe('RelayConnection authentication', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('opens the session when the setup message carries a valid token', async () => {
    const issued = await issueSessionToken(h.store, TENANT, T0);
    await h.connection.onFrame(setupFrame(issued.token), T0);

    expect(h.connection.state).toBe('open');
    expect(h.closed).toStrictEqual([]);
    expect(JSON.parse(h.sent[0] ?? '{}')).toMatchObject({
      type: 'text',
      token: MEASUREMENT_SCRIPT[0]?.ask,
    });
  });

  // The WebSocket URL is public. Anything can connect to it; only the token makes it ours.
  it.each([
    ['no token at all', undefined],
    ['a token that was never issued', 'aaaaaaaaaaaa.bbbbbbbbbbbb'],
    ['a malformed token', 'not-a-token'],
  ])('closes a connection presenting %s', async (_name, token) => {
    await h.connection.onFrame(setupFrame(token), T0);
    expect(h.closed).toStrictEqual([CLOSE_UNAUTHENTICATED]);
    expect(h.sent).toStrictEqual([]);
    expect(h.connection.state).toBe('closed');
  });

  it('closes a connection whose first frame is not setup', async () => {
    await h.connection.onFrame(
      JSON.stringify({ type: 'prompt', voicePrompt: 'x', last: true }),
      T0,
    );
    expect(h.closed).toStrictEqual([CLOSE_UNAUTHENTICATED]);
  });

  it('closes a connection whose first frame is not even a message', async () => {
    await h.connection.onFrame('{ not json', T0);
    expect(h.closed).toStrictEqual([CLOSE_UNAUTHENTICATED]);
  });

  it('rejects a token that has expired', async () => {
    const issued = await issueSessionToken(h.store, TENANT, T0);
    h.clock.advance(SESSION_TOKEN_TTL_MS);
    await h.connection.onFrame(setupFrame(issued.token), T0);
    expect(h.closed).toStrictEqual([CLOSE_UNAUTHENTICATED]);
  });

  // The property a single-use token exists for: a second socket with the same TwiML gets nothing.
  it('rejects a second connection replaying the same token', async () => {
    const issued = await issueSessionToken(h.store, TENANT, T0);
    await h.connection.onFrame(setupFrame(issued.token), T0);
    expect(h.connection.state).toBe('open');

    const second = harness(h.store);
    await second.connection.onFrame(setupFrame(issued.token), T0);
    expect(second.closed).toStrictEqual([CLOSE_UNAUTHENTICATED]);
  });

  it('closes an unauthenticated socket when the setup timeout fires', () => {
    h.connection.onSetupTimeout();
    expect(h.closed).toStrictEqual([CLOSE_SETUP_TIMEOUT]);
  });

  it('does nothing when the setup timeout fires after authentication', async () => {
    const issued = await issueSessionToken(h.store, TENANT, T0);
    await h.connection.onFrame(setupFrame(issued.token), T0);
    h.connection.onSetupTimeout();
    expect(h.closed).toStrictEqual([]);
  });

  it('ignores frames after the connection has closed', async () => {
    await h.connection.onFrame(setupFrame(undefined), T0);
    const sentAfterClose = h.sent.length;
    await h.connection.onFrame(JSON.stringify({ type: 'dtmf', digit: '1' }), T0);
    expect(h.sent).toHaveLength(sentAfterClose);
  });
});

describe('RelayConnection session flow', () => {
  async function opened() {
    const h = harness();
    const issued = await issueSessionToken(h.store, TENANT, T0);
    await h.connection.onFrame(setupFrame(issued.token), T0);
    h.sent.length = 0;
    return h;
  }

  it('speaks a read-back and the next ask for each answered slot', async () => {
    const h = await opened();
    await h.connection.onFrame(
      JSON.stringify({ type: 'prompt', voicePrompt: 'Anna Schmidt', last: true }),
      T0,
    );
    expect(
      h.sent.map((f) => JSON.parse(f) as { token?: string }).map((m) => m.token),
    ).toStrictEqual(['Ich habe verstanden: Anna Schmidt.', MEASUREMENT_SCRIPT[1]?.ask]);
  });

  // INV-19: a message type we do not know must not end a call.
  it('keeps the call open when the provider sends an unknown message type', async () => {
    const h = await opened();
    await h.connection.onFrame(JSON.stringify({ type: 'sentiment', score: 0.2 }), T0);
    expect(h.closed).toStrictEqual([]);
    expect(h.connection.state).toBe('open');
  });

  it('records the summary and closes normally when the script completes', async () => {
    const h = await opened();
    for (const step of MEASUREMENT_SCRIPT) {
      const frame =
        step.expects === 'dtmf'
          ? JSON.stringify({ type: 'dtmf', digit: '1' })
          : JSON.stringify({ type: 'prompt', voicePrompt: 'wert', last: true });
      await h.connection.onFrame(frame, T0);
    }
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]?.tenantId).toBe(TENANT);
    expect(h.recorded[0]?.observations).toHaveLength(MEASUREMENT_SCRIPT.length);
    expect(h.closed).toStrictEqual([CLOSE_NORMAL]);
  });

  it('carries the tenant from the token, not from anything in the message', async () => {
    const h = await opened();
    for (const step of MEASUREMENT_SCRIPT) {
      await h.connection.onFrame(
        step.expects === 'dtmf'
          ? JSON.stringify({ type: 'dtmf', digit: '1' })
          : JSON.stringify({ type: 'prompt', voicePrompt: 'x', last: true, tenantId: 'attacker' }),
        T0,
      );
    }
    expect(h.recorded[0]?.tenantId).toBe(TENANT);
  });
});
