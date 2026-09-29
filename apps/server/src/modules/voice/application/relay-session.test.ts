import { fixedClock } from '@moin/kernel';
import { decodeInbound, type OutboundMessage } from '@moin/telephony';
import { describe, expect, it } from 'vitest';
import { CLOSING_LINE, MEASUREMENT_SCRIPT } from '../domain/measurement-script.ts';
import { RelaySession, type SessionSummary } from './relay-session.ts';

const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';
const T0 = Date.UTC(2026, 8, 29, 9, 0, 0);

function session(): { relay: RelaySession; clock: ReturnType<typeof fixedClock> } {
  const clock = fixedClock(new Date(T0));
  return { relay: new RelaySession(TENANT, clock), clock };
}

function spoken(messages: readonly OutboundMessage[]): string[] {
  return messages.filter((m) => m.type === 'text').map((m) => m.token);
}

describe('RelaySession', () => {
  it('asks the first slot only after setup', () => {
    const { relay, clock } = session();
    // A prompt before setup is not a turn: there is no session to attribute it to.
    expect(
      relay.handle({ type: 'prompt', voicePrompt: 'hallo', last: true }, clock.now().getTime())
        .send,
    ).toStrictEqual([]);

    const step = relay.handle(
      { type: 'setup', sessionId: 'VX1', callSid: 'CA1' },
      clock.now().getTime(),
    );
    expect(spoken(step.send)).toStrictEqual([MEASUREMENT_SCRIPT[0]?.ask]);
  });

  it('ignores a second setup rather than restarting the call', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    expect(
      relay.handle({ type: 'setup', sessionId: 'VX2', callSid: 'CA2' }, clock.now().getTime()).send,
    ).toStrictEqual([]);
  });

  it('reads back each slot and asks the next', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());

    const step = relay.handle(
      { type: 'prompt', voicePrompt: 'Anna Schmidt', last: true },
      clock.now().getTime(),
    );
    expect(spoken(step.send)).toStrictEqual([
      'Ich habe verstanden: Anna Schmidt.',
      MEASUREMENT_SCRIPT[1]?.ask,
    ]);
    expect(step.summary).toBeUndefined();
  });

  // An interim transcript is not an answer. Treating it as one would advance the script while the
  // caller is still mid-sentence, and every slot after it would be off by one.
  it('ignores interim transcripts', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    expect(
      relay.handle({ type: 'prompt', voicePrompt: 'Anna' }, clock.now().getTime()).send,
    ).toStrictEqual([]);
    expect(
      relay.handle({ type: 'prompt', voicePrompt: 'Anna Schm', last: false }, clock.now().getTime())
        .send,
    ).toStrictEqual([]);
  });

  it('measures only the time between the transcript arriving and the reply being ready', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());

    const arrivedAt = clock.now().getTime();
    clock.advance(37);
    relay.handle({ type: 'prompt', voicePrompt: 'Anna Schmidt', last: true }, arrivedAt);

    const summary = runToEnd(relay, clock, 1);
    expect(summary.observations[0]?.serverTurnaroundMs).toBe(37);
  });

  it('records an interruption against the slot the caller talked over', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    relay.handle(
      { type: 'prompt', voicePrompt: 'Anna Schmidt', last: true },
      clock.now().getTime(),
    );
    relay.handle(
      { type: 'interrupt', utteranceUntilInterrupt: 'nein', durationUntilInterruptMs: 400 },
      clock.now().getTime(),
    );
    relay.handle({ type: 'prompt', voicePrompt: '040 123456', last: true }, clock.now().getTime());

    const summary = runToEnd(relay, clock, 2);
    expect(summary.observations[0]?.interrupted).toBe(false);
    expect(summary.observations[1]?.interrupted).toBe(true);
  });

  it('accepts a keypress only at the step that asks for one', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    // The first step asks for speech; a stray keypress must not consume it.
    expect(relay.handle({ type: 'dtmf', digit: '1' }, clock.now().getTime()).send).toStrictEqual(
      [],
    );

    const summary = runToEnd(relay, clock, 0);
    expect(summary.observations.map((o) => o.slot)).toStrictEqual(
      MEASUREMENT_SCRIPT.map((s) => s.slot),
    );
    expect(summary.observations.at(-1)?.heard).toBe('1');
  });

  it('ends with the closing line and a handoff that carries no personal data', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    const summary = runToEnd(relay, clock, 0);

    expect(summary.completed).toBe(true);
    expect(summary.observations).toHaveLength(MEASUREMENT_SCRIPT.length);
    expect(relay.ended).toBe(true);
  });

  // INV-12. handoffData is posted to the action URL and appears in the tenant's provider console.
  it('puts outcome codes, never utterances, into handoffData', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());

    let handoff = '';
    for (const step of MEASUREMENT_SCRIPT) {
      const heard = step.expects === 'dtmf' ? '1' : 'Anna Schmidt, 040 123456, 20095';
      const result =
        step.expects === 'dtmf'
          ? relay.handle({ type: 'dtmf', digit: heard }, clock.now().getTime())
          : relay.handle({ type: 'prompt', voicePrompt: heard, last: true }, clock.now().getTime());
      for (const message of result.send) {
        if (message.type === 'end') {
          handoff = message.handoffData;
        }
      }
    }
    expect(handoff).not.toBe('');
    expect(handoff).not.toContain('Anna');
    expect(handoff).not.toContain('040');
    expect(handoff).not.toContain('20095');
    expect(JSON.parse(handoff)).toStrictEqual({
      reasonCode: 'measurement-complete',
      slots: MEASUREMENT_SCRIPT.length,
      unknownMessageTypes: 0,
    });
  });

  it('closes the session when the provider reports an error', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    const step = relay.handle(
      { type: 'error', description: 'tts unavailable' },
      clock.now().getTime(),
    );
    expect(step.summary?.completed).toBe(false);
    expect(step.send.some((m) => m.type === 'end')).toBe(true);
    // Nothing after the end message is sent.
    expect(
      relay.handle({ type: 'prompt', voicePrompt: 'hallo', last: true }, clock.now().getTime())
        .send,
    ).toStrictEqual([]);
  });

  // INV-19: an unknown message type is recorded and the call continues.
  it('records unknown message types without ending the call', () => {
    const { relay, clock } = session();
    relay.handleFrame(
      decodeInbound(JSON.stringify({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' })),
      clock.now().getTime(),
    );
    relay.handleFrame(
      decodeInbound(JSON.stringify({ type: 'sentiment', score: 0.3 })),
      clock.now().getTime(),
    );
    relay.handleFrame(
      decodeInbound(JSON.stringify({ type: 'sentiment', score: 0.9 })),
      clock.now().getTime(),
    );
    relay.handleFrame(decodeInbound('{ not json'), clock.now().getTime());

    expect(relay.unknownMessageTypes).toStrictEqual(['sentiment']);
    expect(relay.ended).toBe(false);

    const step = relay.handleFrame(
      decodeInbound(JSON.stringify({ type: 'prompt', voicePrompt: 'Anna', last: true })),
      clock.now().getTime(),
    );
    expect(spoken(step.send)[0]).toBe('Ich habe verstanden: Anna.');
  });
});

/** Drives the remaining script steps and returns the summary the final turn produces. */
function runToEnd(
  relay: RelaySession,
  clock: ReturnType<typeof fixedClock>,
  fromStep: number,
): SessionSummary {
  let summary: SessionSummary | undefined;
  for (const step of MEASUREMENT_SCRIPT.slice(fromStep)) {
    const result =
      step.expects === 'dtmf'
        ? relay.handle({ type: 'dtmf', digit: '1' }, clock.now().getTime())
        : relay.handle({ type: 'prompt', voicePrompt: 'wert', last: true }, clock.now().getTime());
    summary = result.summary ?? summary;
  }
  if (summary === undefined) {
    throw new Error('the script did not end');
  }
  return summary;
}

describe('the closing line', () => {
  it('is spoken as the last thing before the session ends', () => {
    const { relay, clock } = session();
    relay.handle({ type: 'setup', sessionId: 'VX1', callSid: 'CA1' }, clock.now().getTime());
    let last: readonly OutboundMessage[] = [];
    for (const step of MEASUREMENT_SCRIPT) {
      last =
        step.expects === 'dtmf'
          ? relay.handle({ type: 'dtmf', digit: '1' }, clock.now().getTime()).send
          : relay.handle({ type: 'prompt', voicePrompt: 'x', last: true }, clock.now().getTime())
              .send;
    }
    expect(spoken(last).at(-1)).toBe(CLOSING_LINE);
    expect(last.at(-1)?.type).toBe('end');
  });
});
