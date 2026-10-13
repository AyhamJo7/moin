/**
 * The voice module (P04.04.04, P11.02).
 *
 * It wires three things that the framework cannot wire for us:
 *
 *   - **the WebSocket route**, because Nest's Fastify adapter does not model one;
 *   - **the measurement sink**, which is the no-op implementation unless a development
 *     configuration explicitly asks for a file;
 *   - **the route resolver**, the platform-owned pre-tenancy dialled-number lookup.
 *
 * All happen in `onModuleInit`, which Nest runs during `app.init()` — before `listen()`, and
 * therefore before Fastify's plugin registration closes.
 */

import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { systemClock, type Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import { createInMemorySessionTokenStore, type SessionTokenStore } from '@moin/telephony';
import { Inject } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.ts';
import type { Config } from '../../config/env.ts';
import { LOGGER } from '../../observability/logger.module.ts';
import { RouteResolverModule } from '../platform/route-resolver.module.ts';
import { noMeasurementSink, type MeasurementSink } from './application/relay-connection.ts';
import { VoiceController } from './http/voice.controller.ts';
import { TwilioSignatureGuard } from './http/twilio-signature.guard.ts';
import { createFileMeasurementSink } from './infrastructure/measurement-sink.ts';
import { registerRelayTransport } from './infrastructure/relay-transport.ts';
import { createInMemoryCallDedup } from './application/call-dedup.ts';
import { CALL_DEDUP, CLOCK, MEASUREMENT_SINK, SESSION_TOKENS } from './voice.tokens.ts';

@Module({
  imports: [RouteResolverModule],
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
      // In-process CallSid claims. Same scaling note as the session tokens:
      // a second voice instance needs Valkey; the port is already the one.
      provide: CALL_DEDUP,
      useFactory: () => createInMemoryCallDedup(),
    },
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
