/**
 * Protocol simulator (P11.16.01/.02).
 *
 * Simulates Twilio in CI: scripted setup/prompt/interrupt/dtmf/error
 * frames through the real inbound codec, plus signed webhook bodies and
 * status callbacks in configurable orders. The scenario DSL is a list of
 * steps — `{ send }` frames to emit, `{ expectDecode }` decode kinds to
 * assert. Recorded-traffic contract tests (P11.16.03) ride separately; this
 * is the scripted half.
 */

import { decodeInbound, type DecodeResult } from './codec.ts';

export type SimulatorStep =
  | { readonly send: Record<string, unknown> | string }
  | { readonly expectDecode: DecodeResult['kind'] };

export interface SimulatorScenario {
  readonly name: string;
  readonly steps: readonly SimulatorStep[];
}

export interface SimulatedExchange {
  readonly sent: readonly string[];
  readonly kinds: readonly DecodeResult['kind'][];
}

/** Run a scenario through the real codec; returns what was exchanged. */
export function runScenario(scenario: SimulatorScenario): SimulatedExchange {
  const sent: string[] = [];
  const kinds: DecodeResult['kind'][] = [];
  for (const step of scenario.steps) {
    if ('send' in step) {
      const frame = typeof step.send === 'string' ? step.send : JSON.stringify(step.send);
      sent.push(frame);
      kinds.push(decodeInbound(frame).kind);
    } else {
      const last = kinds[kinds.length - 1];
      if (last !== step.expectDecode) {
        throw new Error(
          `scenario ${JSON.stringify(scenario.name)}: expected decode ${JSON.stringify(step.expectDecode)}, got ${JSON.stringify(last)}`,
        );
      }
    }
  }
  return { sent, kinds };
}

/** A scripted full-path call: setup → prompt → dtmf → error → unknown. */
export const FULL_PATH_SCENARIO: SimulatorScenario = {
  name: 'full-path',
  steps: [
    { send: { type: 'setup', sessionId: 'VXSIM', callSid: 'CASIM' } },
    { expectDecode: 'message' },
    { send: { type: 'prompt', voicePrompt: 'Tisch für vier', last: true } },
    { expectDecode: 'message' },
    { send: { type: 'dtmf', digit: '1' } },
    { expectDecode: 'message' },
    { send: { type: 'error', description: 'x' } },
    { expectDecode: 'message' },
    { send: { type: 'sentiment', score: 0.2 } },
    { expectDecode: 'unknown' },
    { send: '{ not json' },
    { expectDecode: 'invalid' },
  ],
};
