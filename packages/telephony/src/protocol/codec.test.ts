import { describe, expect, it } from 'vitest';
import { decodeInbound, encodeOutbound } from './codec.ts';
import { end, play, sendDigits, switchLanguage, text } from './outbound.ts';

function frame(value: unknown): string {
  return JSON.stringify(value);
}

describe('decodeInbound', () => {
  it('decodes each known inbound type', () => {
    const cases: readonly [string, unknown][] = [
      [
        'setup',
        { type: 'setup', sessionId: 'VX1', callSid: 'CA1', from: '+4940123', to: '+4940999' },
      ],
      ['prompt', { type: 'prompt', voicePrompt: 'Ich möchte einen Termin', last: true }],
      [
        'interrupt',
        { type: 'interrupt', utteranceUntilInterrupt: 'Guten', durationUntilInterruptMs: 820 },
      ],
      ['dtmf', { type: 'dtmf', digit: '2' }],
      ['error', { type: 'error', description: 'tts failed' }],
    ];
    for (const [type, payload] of cases) {
      const result = decodeInbound(frame(payload));
      expect(result.kind, type).toBe('message');
      if (result.kind === 'message') {
        expect(result.message.type).toBe(type);
      }
    }
  });

  it('accepts a Uint8Array frame', () => {
    const bytes = new TextEncoder().encode(frame({ type: 'dtmf', digit: '#' }));
    const result = decodeInbound(bytes);
    expect(result.kind).toBe('message');
  });

  // INV-19: a provider adding a message type must not end a call. Unknown is a value, not a throw.
  it('reports an unknown type instead of failing', () => {
    const result = decodeInbound(frame({ type: 'sentiment', score: 0.4 }));
    expect(result).toStrictEqual({ kind: 'unknown', type: 'sentiment' });
  });

  it('keeps fields the schema does not name, so a provider addition is not data loss', () => {
    const result = decodeInbound(
      frame({ type: 'prompt', voicePrompt: 'hallo', confidence: 0.93, newFieldFromTwilio: 'x' }),
    );
    expect(result.kind).toBe('message');
    if (result.kind === 'message' && result.message.type === 'prompt') {
      expect(result.message['confidence']).toBe(0.93);
      expect(result.message['newFieldFromTwilio']).toBe('x');
    }
  });

  it.each([
    ['not JSON', 'not json at all', 'frame is not valid JSON'],
    ['no type field', frame({ voicePrompt: 'hallo' }), 'frame has no string "type" field'],
    ['non-string type', frame({ type: 7 }), 'frame has no string "type" field'],
    ['not an object', frame('hello'), 'frame has no string "type" field'],
  ])('rejects %s', (_name, input, reason) => {
    expect(decodeInbound(input)).toStrictEqual({ kind: 'invalid', type: undefined, reason });
  });

  it('rejects a frame that is not valid UTF-8', () => {
    const result = decodeInbound(new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(result).toStrictEqual({
      kind: 'invalid',
      type: undefined,
      reason: 'frame is not valid UTF-8',
    });
  });

  it('reports a known type with a missing required field as invalid', () => {
    const result = decodeInbound(frame({ type: 'dtmf' }));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.type).toBe('dtmf');
      expect(result.reason).toContain('digit');
    }
  });

  // INV-12: the caller's words must never reach a log. The decode failure path is where they
  // usually escape, because validation libraries quote the value they rejected.
  it('never echoes the rejected content in the failure reason', () => {
    const secret = 'Mein Name ist Anna Schmidt, Hauptstrasse 4';
    const result = decodeInbound(frame({ type: 'dtmf', digit: 42, voicePrompt: secret }));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).not.toContain('Anna');
      expect(result.reason).not.toContain('Schmidt');
      expect(result.reason).not.toContain('Hauptstrasse');
      expect(result.reason).not.toContain('42');
    }
  });
});

describe('encodeOutbound', () => {
  it('round-trips every outbound constructor through JSON', () => {
    const messages = [
      text('Guten Tag', false),
      text('Wie kann ich helfen?', true, { interruptible: true, preemptible: false }),
      play('https://cdn.example.de/notruf.mp3', { loop: 1 }),
      sendDigits('12#'),
      switchLanguage({ tts: 'de-DE', transcription: 'de-DE' }),
      end({ outcome: 'booking_created', reasonCode: 'completed' }),
    ];
    for (const message of messages) {
      expect(JSON.parse(encodeOutbound(message))).toStrictEqual(message);
    }
  });

  it('encodes handoffData as a JSON string, the way the action URL receives it', () => {
    const encoded = JSON.parse(encodeOutbound(end({ reasonCode: 'live-agent-handoff' }))) as {
      handoffData: string;
    };
    expect(typeof encoded.handoffData).toBe('string');
    expect(JSON.parse(encoded.handoffData)).toStrictEqual({ reasonCode: 'live-agent-handoff' });
  });

  it('omits optional fields that were not set, rather than sending undefined', () => {
    expect(JSON.parse(encodeOutbound(text('hallo', true)))).toStrictEqual({
      type: 'text',
      token: 'hallo',
      last: true,
    });
  });

  it.each([
    ['letters in sendDigits', (): unknown => sendDigits('12a')],
    ['an empty play source', (): unknown => play('')],
    ['a language switch with nothing to switch', (): unknown => switchLanguage({})],
  ])('rejects %s at construction', (_name, build) => {
    expect(build).toThrow();
  });

  it('rejects an outbound object assembled by hand with an unknown field', () => {
    const smuggled = { type: 'text', token: 'x', last: true, callSid: 'CA1' } as never;
    expect(() => encodeOutbound(smuggled)).toThrow();
  });
});
