/**
 * The voice module (P04.04.04).
 *
 * It wires two things that the framework cannot wire for us:
 *
 *   - **the WebSocket route**, because Nest's Fastify adapter does not model one;
 *   - **the measurement sink**, which is the no-op implementation unless a development
 *     configuration explicitly asks for a file.
 *
 * All three happen in `onModuleInit`, which Nest runs during `app.init()` — before `listen()`, and
 * therefore before Fastify's plugin registration closes.
 */

import {
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { systemClock, type Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import { createInMemorySessionTokenStore, type SessionTokenStore } from '@moin/telephony';
import { createPool, type Pool } from '@moin/db/pool';
import { CONFIG } from '../../config/config.module.ts';
import type { Config } from '../../config/env.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { noMeasurementSink, type MeasurementSink } from './application/relay-connection.ts';
import { VoiceController } from './http/voice.controller.ts';
import { TwilioSignatureGuard } from './http/twilio-signature.guard.ts';
import { createFileMeasurementSink } from './infrastructure/measurement-sink.ts';
import { registerRelayTransport } from './infrastructure/relay-transport.ts';
import { CLOCK, MEASUREMENT_SINK, ROUTE_POOL, SESSION_TOKENS } from './voice.tokens.ts';

/** Releases the route pool on shutdown, so `app.close()` leaves no socket open. */
@Injectable()
class RoutePoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(ROUTE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  controllers: [VoiceController],
  providers: [
    TwilioSignatureGuard,
    { provide: CLOCK, useValue: systemClock },
    {
      // In-process for the spike. A second voice instance would not see the first one's tokens,
      // so P11 replaces this with Valkey `GETDEL`; the interface is already the one it needs.
      provide: SESSION_TOKENS,
      useFactory: (): SessionTokenStore => createInMemorySessionTokenStore(),
    },
    {
      provide: MEASUREMENT_SINK,
      inject: [CONFIG],
      useFactory: (config: Config): MeasurementSink =>
        config.VOICE_MEASUREMENT_SINK === undefined
          ? noMeasurementSink
          : createFileMeasurementSink(config.VOICE_MEASUREMENT_SINK),
    },
    {
      // Voice resolves the dialled number before any session exists (P11.01):
      // a moin_app pool for the DEFINER-only resolve_route call, released on
      // shutdown like the tenant pool.
      provide: ROUTE_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool =>
        createPool({
          connectionString: config.DATABASE_URL,
          max: 2,
          application_name: `${config.SERVICE_NAME}-${config.SERVER_ROLE}-route`,
        }),
    },
    RoutePoolLifecycle,
  ],
})
export class VoiceModule implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokenStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEASUREMENT_SINK) private readonly sink: MeasurementSink,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    await registerRelayTransport(fastify, {
      tokens: this.tokens,
      clock: this.clock,
      logger: this.logger,
      sink: this.sink,
    });
  }
}
