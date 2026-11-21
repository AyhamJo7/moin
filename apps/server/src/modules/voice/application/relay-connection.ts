/**
 * One media WebSocket, from open to close (P04.04.04).
 *
 * The transport owns the socket; this owns what the socket means. It is written against two
 * callbacks — `send` and `close` — rather than against a `WebSocket`, so the authentication
 * sequence, the timeout and the close codes can be tested without a server, and so that swapping
 * the WebSocket library is not a change to the security-relevant code.
 *
 * ## The connection is not trusted until `setup` proves it
 *
 * A WebSocket URL is public. Anything can connect to it. What makes a connection ours is the
 * single-use token we minted for this call and put in the TwiML, which comes back in `setup`.
 * Until that token is claimed, the connection can do nothing: frames are not processed, the
 * session does not exist, and after {@link SETUP_TIMEOUT_MS} it is closed.
 *
 * The `CallSid` in `setup` is deliberately *not* used for this. It is not a secret — it is in
 * every webhook body and in the tenant's own provider console — and the threat model rejected it
 * as an authentication factor.
 *
 * ## Close codes carry no detail
 *
 * A connection rejected for a bad token and one rejected for no token close identically. The
 * distinction goes to the log, where reading it requires access.
 */

import type { Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import {
  consumeSessionToken,
  decodeInbound,
  encodeOutbound,
  type SessionTokenStore,
} from '@moin/telephony';
import {
  CLOSE_NORMAL,
  CLOSE_SETUP_TIMEOUT,
  CLOSE_UNAUTHENTICATED,
  SESSION_TOKEN_PARAMETER,
} from '../domain/relay-contract.ts';
import { RelaySession, type SessionSummary } from './relay-session.ts';

/** Where per-turn measurements go. The no-op implementation is the production one. */
export interface MeasurementSink {
  record(summary: SessionSummary): void;
}

export const noMeasurementSink: MeasurementSink = {
  record(): void {
    // Production keeps nothing: the observations contain what the caller said (INV-07, INV-12).
  },
};

/**
 * Where disclosure playback evidence goes (S1, INV-03). `confirmed`: a caller turn arrived, which
 * the provider sends only after the non-interruptible greeting has finished. `interrupted`: the
 * session authenticated and then closed before any caller turn. A socket that never authenticated
 * records nothing: no greeting was played (absent). Must not throw or block the call.
 */
export interface PlaybackRecorder {
  record(tenantId: string, callSid: string, outcome: 'confirmed' | 'interrupted'): void;
}

export interface ConnectionIo {
  send(frame: string): void;
  close(code: number): void;
}

export interface RelayConnectionDeps {
  readonly io: ConnectionIo;
  readonly tokens: SessionTokenStore;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sink: MeasurementSink;
  readonly playback?: PlaybackRecorder | undefined;
}

type State = 'awaiting-auth' | 'open' | 'closed';

export class RelayConnection {
  #state: State = 'awaiting-auth';
  #session: RelaySession | undefined;
  #call: { readonly tenantId: string; readonly callSid: string } | undefined;
  #playbackRecorded = false;

  constructor(private readonly deps: RelayConnectionDeps) {}

  get state(): State {
    return this.#state;
  }

  /** Called when {@link SETUP_TIMEOUT_MS} passes with no successful authentication. */
  onSetupTimeout(): void {
    if (this.#state !== 'awaiting-auth') {
      return;
    }
    this.deps.logger.warn(
      { reason: 'setup-timeout', outcome: 'closed' },
      'closing a relay socket that never authenticated',
    );
    this.#closeWith(CLOSE_SETUP_TIMEOUT);
  }

  async onFrame(frame: string | Uint8Array, receivedAtMs: number): Promise<void> {
    if (this.#state === 'closed') {
      return;
    }
    const decoded = decodeInbound(frame);

    if (this.#state === 'awaiting-auth') {
      await this.#authenticate(decoded, receivedAtMs);
      return;
    }

    const session = this.#session;
    /* c8 ignore next 3 -- `open` implies a session; kept because that is a claim about two fields. */
    if (session === undefined) {
      this.#closeWith(CLOSE_UNAUTHENTICATED);
      return;
    }

    if (decoded.kind === 'message' && decoded.message.type === 'prompt') {
      this.#recordPlayback('confirmed');
    }
    const step = session.handleFrame(decoded, receivedAtMs);
    for (const message of step.send) {
      this.deps.io.send(encodeOutbound(message));
    }
    if (step.summary !== undefined) {
      this.deps.sink.record(step.summary);
      this.deps.logger.info(
        {
          sessionId: step.summary.sessionId,
          callId: step.summary.callSid,
          outcome: step.summary.completed ? 'completed' : 'provider-error',
          count: step.summary.observations.length,
          durationMs: step.summary.endedAtMs - step.summary.startedAtMs,
        },
        'relay session finished',
      );
      this.#closeWith(CLOSE_NORMAL);
    }
  }

  /** Called when the socket closes for any reason, including the far end hanging up. */
  onClose(): void {
    this.#state = 'closed';
    this.#recordPlayback('interrupted');
  }

  /** Once per session, and only for an authenticated one: the first verdict stands. */
  #recordPlayback(outcome: 'confirmed' | 'interrupted'): void {
    if (this.#call === undefined || this.#playbackRecorded) return;
    this.#playbackRecorded = true;
    this.deps.playback?.record(this.#call.tenantId, this.#call.callSid, outcome);
  }

  async #authenticate(
    decoded: ReturnType<typeof decodeInbound>,
    receivedAtMs: number,
  ): Promise<void> {
    if (decoded.kind !== 'message' || decoded.message.type !== 'setup') {
      this.deps.logger.warn(
        { reason: 'first-frame-not-setup', outcome: 'closed' },
        'rejected a relay socket',
      );
      this.#closeWith(CLOSE_UNAUTHENTICATED);
      return;
    }

    const token = decoded.message.customParameters?.[SESSION_TOKEN_PARAMETER];
    if (token === undefined) {
      this.deps.logger.warn(
        { reason: 'no-session-token', outcome: 'closed' },
        'rejected a relay socket',
      );
      this.#closeWith(CLOSE_UNAUTHENTICATED);
      return;
    }

    const verdict = await consumeSessionToken(
      this.deps.tokens,
      token,
      this.deps.clock.now().getTime(),
    );
    if (!verdict.ok) {
      this.deps.logger.warn(
        { reason: `session-token-${verdict.reason}`, outcome: 'closed' },
        'rejected a relay socket',
      );
      this.#closeWith(CLOSE_UNAUTHENTICATED);
      return;
    }

    this.#state = 'open';
    this.#call = { tenantId: verdict.tenantId, callSid: decoded.message.callSid };
    const session = new RelaySession(verdict.tenantId, this.deps.clock);
    this.#session = session;
    this.deps.logger.info(
      {
        sessionId: decoded.message.sessionId,
        callId: decoded.message.callSid,
        outcome: 'authenticated',
      },
      'relay session started',
    );

    for (const message of session.handle(decoded.message, receivedAtMs).send) {
      this.deps.io.send(encodeOutbound(message));
    }
  }

  #closeWith(code: number): void {
    this.#state = 'closed';
    this.deps.io.close(code);
  }
}
