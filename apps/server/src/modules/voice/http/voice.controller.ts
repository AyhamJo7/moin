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

import {
  Controller,
  Header,
  HttpCode,
  Inject,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '@moin/kernel';
import type { Logger } from '@moin/observability';
import {
  buildConversationRelayTwiML,
  buildUnassignedTwiML,
  issueSessionToken,
  type SessionTokenStore,
} from '@moin/telephony';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';
import type { RouteResolver } from '../../platform/route-resolver.ts';
import { ROUTE_RESOLVER } from '../../platform/route-resolver.module.ts';
import { VoiceCalls } from '../../platform/voice-calls.ts';
import { buildCallAgainTwiML } from '../application/fallback.ts';
import { classifyCallerId } from '../application/caller-id.ts';
import {
  isCallSid,
  routeInboundCall,
  SYNTHETIC_ACCOUNT_SID,
} from '../application/inbound-route.ts';
import { buildDisclosure, DISCLOSURE_VERSION } from '../domain/disclosure.ts';
import { RELAY_PATH, SESSION_TOKEN_PARAMETER } from '../domain/relay-contract.ts';
import { CLOCK, SESSION_TOKENS } from '../voice.tokens.ts';
import { formParams, TwilioSignatureGuard } from './twilio-signature.guard.ts';

const HTTP_OK = 200;
const SQLSTATE = /^[0-9A-Z]{5}$/u;

/** What failed, without anything the error says about the data: an SQLSTATE or an error class. */
function errorClass(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && SQLSTATE.test(code)) return `sqlstate-${code}`;
  return error instanceof Error ? error.name : 'unknown';
}
const HTTP_NO_CONTENT = 204;

@Controller('voice')
@UseGuards(TwilioSignatureGuard)
export class VoiceController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokenStore,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly calls: VoiceCalls,
    @Optional() @Inject(ROUTE_RESOLVER) private readonly resolver?: RouteResolver | null,
  ) {}

  /**
   * Answers an inbound call.
   *
   * Synthetic traffic only for now (S1): genuine provider traffic gets the
   * neutral message and stores nothing. The dialled number (`To`) resolves to
   * its tenant first (P11.01): unknown or quarantined numbers get the neutral
   * message, never another tenant. Routed calls store the call and the
   * disclosure it is issued, mint a session token for this call (sixty
   * seconds, single use) and answer with the disclosure TwiML in the tenant's
   * name. INV-12: the dialled number never reaches the logs.
   */
  @Post('inbound')
  // Nest answers POST with 201 by default. TwiML is a representation of the call's next step, not
  // a created resource, and 200 is what the provider's documentation and every example show.
  @HttpCode(HTTP_OK)
  @Header('content-type', 'text/xml; charset=utf-8')
  async inbound(@Req() request: FastifyRequest): Promise<string> {
    const websocketOrigin = this.config.VOICE_WEBSOCKET_ORIGIN;
    const publicOrigin = this.config.VOICE_PUBLIC_ORIGIN;
    /* c8 ignore next 3 -- the configuration loader refuses to start the voice role without these. */
    if (websocketOrigin === undefined || publicOrigin === undefined) {
      throw new Error('voice role started without its telephony configuration');
    }

    const body = formParams(request.body);
    const callSid = body['CallSid'] ?? '';
    // Synthetic traffic only (S1): genuine provider traffic carries its own account id and is
    // answered with the neutral message, storing nothing, until the finaliser (S4) and call-data
    // retention, erasure and export (P1) exist. A body that is not a provider call likewise.
    if (body['AccountSid'] !== SYNTHETIC_ACCOUNT_SID || !isCallSid(callSid)) {
      this.logger.info(
        { route: '/voice/inbound', outcome: 'not-synthetic-traffic', direction: 'inbound' },
        'answering a call this release does not serve',
      );
      return buildUnassignedTwiML();
    }

    const answer = await this.#answer(
      websocketOrigin,
      publicOrigin,
      body['To'] ?? '',
      callSid,
      body['From'],
    );
    const fields = { route: '/voice/inbound', outcome: answer.outcome, direction: 'inbound' };
    if (answer.outcome === 'store-failed' || answer.outcome === 'disclosure-retired') {
      this.logger.error(
        answer.reason === undefined ? fields : { ...fields, reason: answer.reason },
        'answering a routed call without a session',
      );
    } else if (answer.outcome !== 'unassigned-number') {
      this.logger.info(fields, 'answering an inbound call');
    }
    return answer.twiml;
  }

  /**
   * The TwiML for one delivery of an inbound webhook. Every failure is answered with speech,
   * never a provider error (INV-19): the spoken call-again message.
   *
   * 1. INV-01, INV-11: `app.route_call` resolves the dialled number and records the first routing
   *    decision for the CallSid in one call. A delivery whose number no longer routes to the
   *    organisation of that first decision (activated, reassigned or released since) gets the
   *    neutral message and stores nothing anywhere.
   * 2. The call row is the dedup: a retry finds it and writes nothing, and gets back the
   *    disclosure inputs first issued, so it speaks the same words. A retry after a deploy that
   *    retired that disclosure version is refused rather than spoken in different words.
   * 3. The caller id is classified first; only a presented E.164 number is stored.
   * 4. A single-use token for this tenant and this call; only one token per call opens a session.
   */
  async #answer(
    websocketOrigin: string,
    publicOrigin: string,
    dialled: string,
    callSid: string,
    from: string | undefined,
  ): Promise<{
    readonly outcome:
      | 'twiml-issued'
      | 'twiml-issued-replay'
      | 'unassigned-number'
      | 'disclosure-retired'
      | 'store-failed';
    readonly twiml: string;
    readonly reason?: string;
  }> {
    const resolver = this.resolver;
    try {
      const decision = await routeInboundCall(dialled, {
        resolveRoute: (e164) =>
          resolver === undefined || resolver === null
            ? Promise.resolve([])
            : resolver.routeCall(e164, callSid),
        countUnassigned: () => {
          this.logger.info(
            { route: '/voice/inbound', outcome: 'unassigned-number', direction: 'inbound' },
            'answering an unassigned number',
          );
        },
      });
      if (!decision.routed) return { outcome: 'unassigned-number', twiml: decision.twiml };

      const caller = from === undefined ? 'withheld' : classifyCallerId(from, new Set([dialled]));
      const recorded = await this.calls.recordInbound({
        organisationId: decision.organisationId,
        callSid,
        from: caller === 'present' ? from?.trim() : undefined,
        to: dialled,
        disclosureVersion: DISCLOSURE_VERSION,
      });
      if (recorded.disclosure.version !== DISCLOSURE_VERSION) {
        return { outcome: 'disclosure-retired', twiml: buildCallAgainTwiML() };
      }
      const issued = await issueSessionToken(
        this.tokens,
        { tenantId: decision.organisationId, callSid },
        this.clock.now().getTime(),
      );
      return {
        outcome: recorded.created ? 'twiml-issued' : 'twiml-issued-replay',
        twiml: this.buildRoutedTwiML(
          websocketOrigin,
          publicOrigin,
          issued.token,
          recorded.disclosure.businessName,
        ),
      };
    } catch (error) {
      return { outcome: 'store-failed', twiml: buildCallAgainTwiML(), reason: errorClass(error) };
    }
  }

  /**
   * One TwiML builder path for every routed call (P11.02.01): the disclosure
   * travels as a value the type system requires, and there is no other way
   * to emit `<ConversationRelay>` from this controller.
   */
  private buildRoutedTwiML(
    websocketOrigin: string,
    publicOrigin: string,
    sessionToken: string,
    businessName: string,
  ): string {
    return buildConversationRelayTwiML({
      websocketUrl: `${websocketOrigin}${RELAY_PATH}`,
      actionUrl: `${publicOrigin}/voice/session-end`,
      disclosure: buildDisclosure(businessName),
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
      parameters: { [SESSION_TOKEN_PARAMETER]: sessionToken },
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
