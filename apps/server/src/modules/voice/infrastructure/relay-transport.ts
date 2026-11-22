/**
 * The WebSocket endpoint (P04.04.04).
 *
 * Deliberately thin. Everything it does is turn socket events into `RelayConnection` calls, so
 * that the interesting behaviour — authentication, the script, the close codes — is tested without
 * a server, and so that replacing the WebSocket library is not a change to security-relevant code.
 *
 * The one thing that must happen here and nowhere else is the setup timer: a connection that never
 * authenticates has to be closed by something, and nothing inside the connection object has a
 * clock that fires.
 */

import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import type { SessionTokenStore } from '@moin/telephony';
import { RELAY_PATH, SETUP_TIMEOUT_MS } from '../domain/relay-contract.ts';
import { RelayConnection, type MeasurementSink } from '../application/relay-connection.ts';

export interface RelayTransportDeps {
  readonly tokens: SessionTokenStore;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sink: MeasurementSink;
}

export async function registerRelayTransport(
  fastify: FastifyInstance,
  deps: RelayTransportDeps,
): Promise<void> {
  await fastify.register(websocket);

  fastify.get(RELAY_PATH, { websocket: true }, (socket) => {
    const connection = new RelayConnection({
      io: {
        send: (frame) => {
          socket.send(frame);
        },
        close: (code) => {
          socket.close(code);
        },
      },
      tokens: deps.tokens,
      clock: deps.clock,
      logger: deps.logger,
      sink: deps.sink,
    });

    const timer = setTimeout(() => {
      connection.onSetupTimeout();
    }, SETUP_TIMEOUT_MS);
    // A pending timer must not hold the process open during a graceful shutdown (INV-19 applies to
    // the call; this applies to the deploy that would otherwise hang waiting for it).
    timer.unref();

    socket.on('message', (data: Buffer) => {
      const receivedAtMs = deps.clock.now().getTime();
      void connection.onFrame(new Uint8Array(data), receivedAtMs).catch((error: unknown) => {
        deps.logger.error({ err: error, outcome: 'frame-handler-failed' }, 'relay frame failed');
        socket.close();
      });
    });

    socket.on('close', () => {
      clearTimeout(timer);
      connection.onClose();
    });

    socket.on('error', () => {
      clearTimeout(timer);
      connection.onClose();
    });
  });
}
