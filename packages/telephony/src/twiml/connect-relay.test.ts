import { describe, expect, it } from 'vitest';
import { buildConversationRelayTwiML, TwiMLBuildError } from './connect-relay.ts';
import type { ConversationRelayOptions } from './connect-relay.ts';

const DISCLOSURE =
  'Guten Tag. Sie sprechen mit einem KI-Assistenten. Das Gespräch wird nicht aufgezeichnet.';

function options(overrides: Partial<ConversationRelayOptions> = {}): ConversationRelayOptions {
  return {
    websocketUrl: 'wss://voice.example.de/relay',
    actionUrl: 'https://voice.example.de/voice/session-end',
    disclosure: DISCLOSURE,
    language: 'de-DE',
    transcription: { provider: 'Deepgram', model: 'nova-3-general' },
    speech: { provider: 'ElevenLabs', voice: 'de-DE-Standard-A' },
    interruptible: true,
    dtmfDetection: true,
    ...overrides,
  };
}

describe('buildConversationRelayTwiML', () => {
  it('emits a stable document', () => {
    expect(
      buildConversationRelayTwiML(options({ parameters: { sessionToken: 'abc.def' } })),
    ).toMatchInlineSnapshot(
      `"<?xml version="1.0" encoding="UTF-8"?><Response><Connect action="https://voice.example.de/voice/session-end"><ConversationRelay url="wss://voice.example.de/relay" welcomeGreeting="Guten Tag. Sie sprechen mit einem KI-Assistenten. Das Gespräch wird nicht aufgezeichnet." welcomeGreetingInterruptible="none" language="de-DE" transcriptionProvider="Deepgram" speechModel="nova-3-general" ttsProvider="ElevenLabs" voice="de-DE-Standard-A" interruptible="true" dtmfDetection="true"><Parameter name="sessionToken" value="abc.def" /></ConversationRelay></Connect></Response>"`,
    );
  });

  // INV-03. This test is the enforcement named in ADR-0010: the disclosure must be spoken in full,
  // and a caller talking over it must not cut it short. There is no option that changes this, so
  // the only way to break it is to edit the builder — and then this fails.
  it('always makes the disclosure non-interruptible, whatever else is configured', () => {
    for (const interruptible of [true, false]) {
      const twiml = buildConversationRelayTwiML(options({ interruptible }));
      expect(twiml).toContain('welcomeGreetingInterruptible="none"');
      expect(twiml).toContain(`welcomeGreeting="${DISCLOSURE}"`);
    }
  });

  it('escapes every XML metacharacter in a tenant-controlled value', () => {
    const twiml = buildConversationRelayTwiML(
      options({
        disclosure: `Müller & Sohn <GmbH> sagt "Hallo" – O'Brien`,
        parameters: { note: `a"b&c<d>e'f` },
      }),
    );
    expect(twiml).toContain(
      'welcomeGreeting="Müller &amp; Sohn &lt;GmbH&gt; sagt &quot;Hallo&quot; – O&apos;Brien"',
    );
    expect(twiml).toContain('value="a&quot;b&amp;c&lt;d&gt;e&apos;f"');
    // The attack this prevents: a quote that closes the attribute and injects another one.
    expect(twiml).not.toMatch(/welcomeGreeting="[^"]*"[^ />]/u);
  });

  it('omits speechModel when no model is configured', () => {
    const twiml = buildConversationRelayTwiML(options({ transcription: { provider: 'Google' } }));
    expect(twiml).not.toContain('speechModel');
    expect(twiml).toContain('transcriptionProvider="Google"');
  });

  it('emits a self-closing element when there are no parameters', () => {
    expect(buildConversationRelayTwiML(options())).toContain('dtmfDetection="true" />');
  });

  it.each([
    ['ws:// media url', { websocketUrl: 'ws://voice.example.de/relay' }, /must use wss:/u],
    ['http action url', { actionUrl: 'http://voice.example.de/end' }, /must use https:/u],
    ['not a url', { websocketUrl: 'relay' }, /not a valid URL/u],
    ['empty disclosure', { disclosure: '   ' }, /INV-03/u],
    ['empty language', { language: '' }, /language must not be empty/u],
    ['empty voice', { speech: { provider: 'X', voice: '' } }, /voice must not be empty/u],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() => buildConversationRelayTwiML(options(overrides))).toThrow(TwiMLBuildError);
    expect(() => buildConversationRelayTwiML(options(overrides))).toThrow(message);
  });

  it('rejects a parameter name that is not an XML name', () => {
    expect(() =>
      buildConversationRelayTwiML(options({ parameters: { 'a"/><script': 'x' } })),
    ).toThrow(/not a valid XML name/u);
  });
});
