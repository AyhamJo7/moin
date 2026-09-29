/**
 * The ConversationRelay session as a pure state machine (P04.04.04, P04.05.03).
 *
 * Everything about a voice session that is worth testing is in here, and nothing about WebSockets
 * is. A session takes an inbound message and the moment it arrived, and returns what to say and
 * what was measured; the transport calls it and writes the bytes. That split is what makes it
 * possible to assert the turn ordering, the interruption behaviour and the latency accounting
 * without a phone, an account or a network.
 *
 * ## What is measured here, and what is not
 *
 * End-of-speech to first-audio is *the* number this phase exists to produce, and it cannot be
 * measured here. A server-side figure omits both network legs and the speech synthesis queue,
 * which together are most of what a caller experiences; PLAN P04.05.03 is explicit that the
 * measurement is taken on the caller's device.
 *
 * What this class measures is the slice we are responsible for: the gap between a final transcript
 * arriving and our reply being ready. Reporting that as the caller-side number would be the most
 * flattering possible lie, so it is called `serverTurnaroundMs` and the feasibility report states
 * what it excludes.
 *
 * ## Interruptions are data
 *
 * An `interrupt` during a read-back means the caller heard enough to know we were wrong. It is
 * recorded against the slot and the session moves on rather than repeating itself — which is also
 * what a person would do.
 */

import type { Clock } from '@moin/kernel';
import {
  end,
  text,
  type DecodeResult,
  type InboundMessage,
  type OutboundMessage,
} from '@moin/telephony';
import { CLOSING_LINE, MEASUREMENT_SCRIPT, type SlotKind } from '../domain/measurement-script.ts';

/** One measured turn. Written to the development sink only, never to production telemetry. */
export interface SlotObservation {
  readonly slot: SlotKind;
  /** What the transcriber returned, or the digit received. Personal data: development sink only. */
  readonly heard: string;
  /** Final transcript in, reply ready out. Excludes both network legs and speech synthesis. */
  readonly serverTurnaroundMs: number;
  /** Whether the caller talked over the read-back that preceded this slot. */
  readonly interrupted: boolean;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly callSid: string;
  readonly tenantId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly observations: readonly SlotObservation[];
  /** Message types the provider sent that this version does not understand. */
  readonly unknownMessageTypes: readonly string[];
  readonly completed: boolean;
}

export interface SessionStep {
  readonly send: readonly OutboundMessage[];
  /** Present only on the turn that ends the session. */
  readonly summary?: SessionSummary | undefined;
}

const NOTHING: SessionStep = { send: [] };

type Phase = 'awaiting-setup' | 'asking' | 'ended';

/**
 * A session's whole lifetime. One instance per WebSocket connection; never shared and never
 * reused, because it holds what the caller said.
 */
export class RelaySession {
  #phase: Phase = 'awaiting-setup';
  #stepIndex = 0;
  #sessionId = '';
  #callSid = '';
  #startedAtMs = 0;
  #interruptedCurrentStep = false;
  readonly #observations: SlotObservation[] = [];
  readonly #unknownTypes: string[] = [];

  constructor(
    private readonly tenantId: string,
    private readonly clock: Clock,
  ) {}

  /** Message types seen but not understood, for the transport to log (INV-19). */
  get unknownMessageTypes(): readonly string[] {
    return this.#unknownTypes;
  }

  get ended(): boolean {
    return this.#phase === 'ended';
  }

  /**
   * Handles a decode result rather than a message, so that an unrecognised or malformed frame is
   * accounted for here instead of being dropped by a transport that forgot to.
   */
  handleFrame(result: DecodeResult, receivedAtMs: number): SessionStep {
    switch (result.kind) {
      case 'message':
        return this.handle(result.message, receivedAtMs);
      case 'unknown':
        if (!this.#unknownTypes.includes(result.type)) {
          this.#unknownTypes.push(result.type);
        }
        return NOTHING;
      case 'invalid':
        return NOTHING;
    }
  }

  handle(message: InboundMessage, receivedAtMs: number): SessionStep {
    if (this.#phase === 'ended') {
      return NOTHING;
    }

    switch (message.type) {
      case 'setup':
        return this.#onSetup(message.sessionId, message.callSid, receivedAtMs);
      case 'prompt':
        // Interim results arrive with `last` absent or false; only a final transcript is a turn.
        return message.last === true
          ? this.#onSlotValue(message.voicePrompt, 'speech', receivedAtMs)
          : NOTHING;
      case 'dtmf':
        return this.#onSlotValue(message.digit, 'dtmf', receivedAtMs);
      case 'interrupt':
        this.#interruptedCurrentStep = true;
        return NOTHING;
      case 'error':
        // The provider reporting a broken session. Closed deliberately, so the call is accounted
        // for rather than left to time out (INV-06, INV-19).
        return this.#finish(false);
    }
  }

  #onSetup(sessionId: string, callSid: string, receivedAtMs: number): SessionStep {
    if (this.#phase !== 'awaiting-setup') {
      return NOTHING;
    }
    this.#sessionId = sessionId;
    this.#callSid = callSid;
    this.#startedAtMs = receivedAtMs;
    this.#phase = 'asking';
    const first = MEASUREMENT_SCRIPT[0];
    return { send: first === undefined ? [] : [text(first.ask, true)] };
  }

  #onSlotValue(heard: string, source: 'speech' | 'dtmf', receivedAtMs: number): SessionStep {
    if (this.#phase !== 'asking') {
      return NOTHING;
    }
    const step = MEASUREMENT_SCRIPT[this.#stepIndex];
    if (step === undefined) {
      return this.#finish(true);
    }
    // A keypress during a speech step, or speech during the keypress step, is not the slot we
    // asked for. Ignoring it is what keeps the per-slot accuracy figures meaningful.
    if (step.expects !== source) {
      return NOTHING;
    }

    this.#observations.push({
      slot: step.slot,
      heard,
      serverTurnaroundMs: this.clock.now().getTime() - receivedAtMs,
      interrupted: this.#interruptedCurrentStep,
    });
    this.#interruptedCurrentStep = false;
    this.#stepIndex += 1;

    const readBack = text(step.readBack(heard), false);
    const next = MEASUREMENT_SCRIPT[this.#stepIndex];
    if (next !== undefined) {
      return { send: [readBack, text(next.ask, true)] };
    }
    const closing = this.#finish(true);
    return {
      send: [readBack, text(CLOSING_LINE, true), ...closing.send],
      summary: closing.summary,
    };
  }

  #finish(completed: boolean): SessionStep {
    this.#phase = 'ended';
    const summary: SessionSummary = {
      sessionId: this.#sessionId,
      callSid: this.#callSid,
      tenantId: this.tenantId,
      startedAtMs: this.#startedAtMs,
      endedAtMs: this.clock.now().getTime(),
      observations: [...this.#observations],
      unknownMessageTypes: [...this.#unknownTypes],
      completed,
    };
    // handoffData reaches the action URL and the tenant's own provider console. Outcome codes
    // only — no names, no numbers, no transcript (INV-12).
    return {
      send: [
        end({
          reasonCode: completed ? 'measurement-complete' : 'provider-error',
          slots: summary.observations.length,
          unknownMessageTypes: summary.unknownMessageTypes.length,
        }),
      ],
      summary,
    };
  }
}
