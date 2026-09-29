/**
 * The two HTTP endpoints of a ConversationRelay call (P04.04.04).
 *
 * A call touches HTTP exactly twice: once at the start, when Twilio asks what to do with it, and
 * once at the end, when the session reports how it went. Everything between the two is the
 * WebSocket.
 *
 * Both endpoints are behind {@link TwilioSignatureGuard}. Neither trusts anything in the request
 * body for identity: the inbound webhook mints a fresh single-use token and puts it in the TwiML,
 * and the session-end webhook is a report, not a command — it changes nothing that a forged body
 * could exploit.
 */

import { Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import {
  buildConversationRelayTwiML,
  issueSessionToken,
  type SessionTokenStore,
} from '@moin/telephony';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import { buildDisclosure, FEASIBILITY_BUSINESS_NAME } from '../domain/disclosure.ts';
import { RELAY_PATH, SESSION_TOKEN_PARAMETER } from '../domain/relay-contract.ts';
import { CLOCK, FEASIBILITY_TENANT_ID, SESSION_TOKENS } from '../voice.tokens.ts';
import { TwilioSignatureGuard } from './twilio-signature.guard.ts';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

@Controller('voice')
@UseGuards(TwilioSignatureGuard)
export class VoiceController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokenStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Answers an inbound call.
   *
   * The token is minted per call and expires in sixty seconds, so the TwiML is worthless the
   * moment Twilio has used it — which matters because TwiML is fetched over the public internet
   * and is visible in the tenant's own provider console.
   */
  @Post('inbound')
  // Nest answers POST with 201 by default. TwiML is a representation of the call's next step, not
  // a created resource, and 200 is what the provider's documentation and every example show.
  @HttpCode(HTTP_OK)
  @Header('content-type', 'text/xml; charset=utf-8')
  async inbound(): Promise<string> {
    const websocketOrigin = this.config.VOICE_WEBSOCKET_ORIGIN;
    const publicOrigin = this.config.VOICE_PUBLIC_ORIGIN;
    /* c8 ignore next 3 -- the configuration loader refuses to start the voice role without these. */
    if (websocketOrigin === undefined || publicOrigin === undefined) {
      throw new Error('voice role started without its telephony configuration');
    }

    const issued = await issueSessionToken(
      this.tokens,
      FEASIBILITY_TENANT_ID,
      this.clock.now().getTime(),
    );

    this.logger.info(
      { route: '/voice/inbound', outcome: 'twiml-issued', direction: 'inbound' },
      'answering an inbound call',
    );

    return buildConversationRelayTwiML({
      websocketUrl: `${websocketOrigin}${RELAY_PATH}`,
      actionUrl: `${publicOrigin}/voice/session-end`,
      disclosure: buildDisclosure(FEASIBILITY_BUSINESS_NAME),
      language: this.config.VOICE_LANGUAGE,
      transcription: {
        provider: this.config.VOICE_TRANSCRIPTION_PROVIDER,
        ...(this.config.VOICE_TRANSCRIPTION_MODEL === undefined
          ? {}
          : { model: this.config.VOICE_TRANSCRIPTION_MODEL }),
      },
      speech: { provider: this.config.VOICE_TTS_PROVIDER, voice: this.config.VOICE_TTS_VOICE },
      interruptible: this.config.VOICE_INTERRUPTIBLE,
      dtmfDetection: true,
      parameters: { [SESSION_TOKEN_PARAMETER]: issued.token },
    });
  }

  /**
   * Receives `SessionStatus` and `HandoffData` when the `<Connect>` verb ends.
   *
   * `HandoffData` is our own JSON, sent back to us by way of the provider, so it is read
   * defensively and only its outcome code is logged: everything in it has been outside our trust
   * boundary, and the log allowlist would redact anything else anyway (INV-12).
   */
  @Post('session-end')
  @HttpCode(HTTP_NO_CONTENT)
  sessionEnd(@Req() request: FastifyRequest): void {
    const body = (request.body ?? {}) as Record<string, string>;
    const status = body['SessionStatus'] ?? 'unknown';
    let reasonCode = 'unparseable';
    const handoff = body['HandoffData'];
    if (handoff !== undefined) {
      try {
        const parsed: unknown = JSON.parse(handoff);
        if (typeof parsed === 'object' && parsed !== null) {
          const value: unknown = (parsed as Record<string, unknown>)['reasonCode'];
          reasonCode = typeof value === 'string' ? value : 'absent';
        }
      } catch {
        reasonCode = 'unparseable';
      }
    } else {
      reasonCode = 'absent';
    }

    this.logger.info(
      { route: '/voice/session-end', outcome: status, reason: reasonCode, direction: 'inbound' },
      'conversation relay session ended',
    );
  }
}
