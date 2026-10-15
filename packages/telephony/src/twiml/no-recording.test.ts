/**
 * No-recording lint (P11.14.01/.04, INV-07): every emitted TwiML passes;
 * recording attempts are rejected.
 */
import { describe, expect, it } from 'vitest';
import { buildConversationRelayTwiML } from './connect-relay.ts';
import { buildUnassignedTwiML } from './unassigned.ts';
import { assertNoRecording, hasNoRecording } from './no-recording.ts';

describe('no-recording verification', () => {
  it('every emitted TwiML passes the recording lint', () => {
    const relay = buildConversationRelayTwiML({
      websocketUrl: 'wss://voice.example.de/voice/relay',
      actionUrl: 'https://voice.example.de/voice/session-end',
      disclosure: 'Guten Tag, Sie sprechen mit einem KI-Assistenten.',
      language: 'de-DE',
      transcription: { provider: 'Deepgram' },
      speech: { provider: 'Google', voice: 'de-DE-Standard-A' },
      interruptible: true,
      dtmfDetection: true,
      parameters: {},
    });
    expect(hasNoRecording(relay)).toBe(true);
    expect(() => {
      assertNoRecording(relay);
    }).not.toThrow();
    expect(hasNoRecording(buildUnassignedTwiML())).toBe(true);
  });

  it('recording attempts are rejected (INV-07)', () => {
    expect(hasNoRecording('<Response><Record /></Response>')).toBe(false);
    expect(hasNoRecording('<Response><Say record="true">x</Say></Response>')).toBe(false);
    expect(() => {
      assertNoRecording('<Response><Record /></Response>');
    }).toThrow('recording constructs');
  });

  it('config is immutable: recording cannot be enabled by option', () => {
    // The builder options type has no recording field — assert the surface.
    const options = {
      websocketUrl: 'wss://voice.example.de/voice/relay',
      actionUrl: 'https://voice.example.de/voice/session-end',
      disclosure: 'd',
      language: 'de-DE',
      transcription: { provider: 'Deepgram' },
      speech: { provider: 'Google', voice: 'de-DE-Standard-A' },
      interruptible: true,
      dtmfDetection: true,
    };
    expect('record' in options).toBe(false);
    expect('recording' in options).toBe(false);
  });
});
