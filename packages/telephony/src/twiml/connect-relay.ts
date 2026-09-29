/**
 * The `<Connect><ConversationRelay>` TwiML document (P04.04.01).
 *
 * This is the smallest document in the system and the one with the most invariants attached to it.
 * It is the answer to Twilio's inbound webhook, and it decides four things that cannot be fixed
 * later in the call: whether the caller hears the AI disclosure, whether they can talk over it,
 * where the media session connects, and what the session carries with it.
 *
 * ## INV-03 is structural here, not a convention
 *
 * German law and our own product rules require a full AI disclosure before an AI voice session
 * begins. In TwiML that is two attributes: `welcomeGreeting`, and
 * `welcomeGreetingInterruptible="none"` so that a caller who starts speaking does not cut it off.
 *
 * A configuration flag for the second attribute would be a flag that can be set wrong, in an
 * environment file, at 2 a.m., by someone reducing "dead air at the start of calls". So there is
 * no flag. The builder always emits `none`, the options type has no field for it, and a test
 * asserts the attribute is present in the output. Changing that behaviour requires editing this
 * file and deleting a test that says why it exists.
 *
 * `interruptible` — whether the caller can interrupt the *assistant* later in the conversation —
 * is a genuine product decision and is configurable. The two are deliberately separate attributes
 * with separate meanings; conflating them is how the disclosure becomes interruptible by accident.
 *
 * ## The attribute set is provider-defined
 *
 * The attributes emitted here follow PLAN P04.04.01. The exact set ConversationRelay accepts,
 * and its behaviour when an unknown attribute is present, is Twilio's to define and has **not**
 * been verified against a live session — that is P04.04.06, which needs an account and a German
 * number. Until then this builder is verified only against its own fixtures.
 */

import { escapeXml } from './escape.ts';

/** Thrown when the options cannot produce a document that is safe to answer a call with. */
export class TwiMLBuildError extends Error {
  public override readonly name = 'TwiMLBuildError';
}

/**
 * Speech-to-text configuration. Provider and model are strings rather than a union because the
 * set is Twilio's and changes without our release cycle; an unknown value must reach Twilio and be
 * rejected loudly, not be silently dropped by our own type.
 */
export interface TranscriptionConfig {
  readonly provider: string;
  readonly model?: string;
}

/** Text-to-speech configuration. */
export interface SpeechConfig {
  readonly provider: string;
  readonly voice: string;
}

export interface ConversationRelayOptions {
  /** The media WebSocket. Must be `wss:` — a `ws:` session would carry speech in clear text. */
  readonly websocketUrl: string;
  /** `<Connect action>`: where Twilio posts `SessionStatus` and `HandoffData` when the session ends. */
  readonly actionUrl: string;
  /**
   * The AI disclosure (INV-03). Spoken in full before the session starts, and not interruptible.
   * Empty text is rejected: a call that starts without it is a call we may not take.
   */
  readonly disclosure: string;
  /** BCP-47 tag, e.g. `de-DE`. */
  readonly language: string;
  readonly transcription: TranscriptionConfig;
  readonly speech: SpeechConfig;
  /** Whether the caller may interrupt the assistant *after* the disclosure. */
  readonly interruptible: boolean;
  /** Whether Twilio reports DTMF keypresses as protocol messages. */
  readonly dtmfDetection: boolean;
  /**
   * `<Parameter>` children, delivered in the `setup` message. This is how the session token
   * (PLAN P11.04) reaches the WebSocket handler, because the handler cannot trust anything else
   * about the connection. Values are escaped; names are validated.
   */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** XML names we are willing to emit as a `<Parameter name>`; deliberately narrow. */
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function requireUrl(value: string, field: string, protocol: 'wss:' | 'https:'): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TwiMLBuildError(`${field} is not a valid URL`);
  }
  if (url.protocol !== protocol) {
    throw new TwiMLBuildError(`${field} must use ${protocol}, not ${url.protocol}`);
  }
  return url;
}

function attribute(name: string, value: string): string {
  return ` ${name}="${escapeXml(value)}"`;
}

/**
 * Builds the TwiML answered to an inbound call.
 *
 * Attributes are emitted in a fixed order so that a snapshot test compares content rather than
 * serialisation order, and so a diff on this file reads as a change in behaviour.
 */
export function buildConversationRelayTwiML(options: ConversationRelayOptions): string {
  const websocketUrl = requireUrl(options.websocketUrl, 'websocketUrl', 'wss:');
  const actionUrl = requireUrl(options.actionUrl, 'actionUrl', 'https:');

  if (options.disclosure.trim() === '') {
    throw new TwiMLBuildError('disclosure must not be empty (INV-03)');
  }
  if (options.language.trim() === '') {
    throw new TwiMLBuildError('language must not be empty');
  }
  if (options.transcription.provider.trim() === '' || options.speech.provider.trim() === '') {
    throw new TwiMLBuildError('transcription and speech providers must not be empty');
  }
  if (options.speech.voice.trim() === '') {
    throw new TwiMLBuildError('speech voice must not be empty');
  }

  const parameters = Object.entries(options.parameters ?? {});
  for (const [name] of parameters) {
    if (!PARAMETER_NAME.test(name)) {
      throw new TwiMLBuildError(`parameter name ${JSON.stringify(name)} is not a valid XML name`);
    }
  }

  let relay = '<ConversationRelay';
  relay += attribute('url', websocketUrl.toString());
  relay += attribute('welcomeGreeting', options.disclosure);
  // INV-03. Not configurable, by design — see the module comment.
  relay += attribute('welcomeGreetingInterruptible', 'none');
  relay += attribute('language', options.language);
  relay += attribute('transcriptionProvider', options.transcription.provider);
  if (options.transcription.model !== undefined) {
    relay += attribute('speechModel', options.transcription.model);
  }
  relay += attribute('ttsProvider', options.speech.provider);
  relay += attribute('voice', options.speech.voice);
  relay += attribute('interruptible', options.interruptible ? 'true' : 'false');
  relay += attribute('dtmfDetection', options.dtmfDetection ? 'true' : 'false');

  if (parameters.length === 0) {
    relay += ' />';
  } else {
    relay += '>';
    for (const [name, value] of parameters) {
      relay += `<Parameter${attribute('name', name)}${attribute('value', value)} />`;
    }
    relay += '</ConversationRelay>';
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    `<Connect${attribute('action', actionUrl.toString())}>` +
    relay +
    '</Connect>' +
    '</Response>'
  );
}
