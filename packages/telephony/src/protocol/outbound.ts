/**
 * Messages we send to ConversationRelay (P04.04.02).
 *
 * These are strict, and for the mirror-image reason that the inbound ones are loose: this side is
 * ours. A typo in an outbound field name is our defect, and the cheapest place to find it is the
 * moment the object is built, not in a Twilio error that says a session ended.
 *
 * Every outbound message is constructed through the functions below rather than as an object
 * literal, so that the wire shape has exactly one definition.
 */

import { z } from 'zod';

/** `text` — speak this. `last` closes the turn; without it the assistant is still speaking. */
export const textMessage = z.strictObject({
  type: z.literal('text'),
  token: z.string(),
  last: z.boolean(),
  interruptible: z.boolean().optional(),
  preemptible: z.boolean().optional(),
});

/** `play` — play recorded audio: used for the life-safety scripts (INV-13), where wording is fixed. */
export const playMessage = z.strictObject({
  type: z.literal('play'),
  source: z.string().min(1),
  loop: z.number().int().nonnegative().optional(),
  preemptible: z.boolean().optional(),
});

/** `sendDigits` — emit DTMF towards the far end, e.g. when bridged into a menu. */
export const sendDigitsMessage = z.strictObject({
  type: z.literal('sendDigits'),
  digits: z.string().regex(/^[0-9*#w]+$/u, 'digits may contain 0-9, *, # and w'),
});

/** `language` — switch STT and/or TTS language mid-session. */
export const languageMessage = z.strictObject({
  type: z.literal('language'),
  ttsLanguage: z.string().min(1).optional(),
  transcriptionLanguage: z.string().min(1).optional(),
});

/**
 * `end` — close the session and hand control back to the `<Connect action>` URL.
 *
 * `handoffData` is a JSON *string*, not an object: that is how Twilio delivers it to the action
 * URL, and encoding it here keeps the caller from discovering the difference in production.
 */
export const endMessage = z.strictObject({
  type: z.literal('end'),
  handoffData: z.string(),
});

export const outboundMessage = z.union([
  textMessage,
  playMessage,
  sendDigitsMessage,
  languageMessage,
  endMessage,
]);

export type TextMessage = z.infer<typeof textMessage>;
export type PlayMessage = z.infer<typeof playMessage>;
export type SendDigitsMessage = z.infer<typeof sendDigitsMessage>;
export type LanguageMessage = z.infer<typeof languageMessage>;
export type EndMessage = z.infer<typeof endMessage>;
export type OutboundMessage = z.infer<typeof outboundMessage>;

/** Speak a token. `last: true` ends the assistant's turn. */
export function text(
  token: string,
  last: boolean,
  options?: {
    readonly interruptible?: boolean;
    readonly preemptible?: boolean;
  },
): TextMessage {
  return textMessage.parse({
    type: 'text',
    token,
    last,
    ...(options?.interruptible === undefined ? {} : { interruptible: options.interruptible }),
    ...(options?.preemptible === undefined ? {} : { preemptible: options.preemptible }),
  });
}

/** Play fixed audio. Used where the wording is reviewed and must not vary (INV-13). */
export function play(
  source: string,
  options?: {
    readonly loop?: number;
    readonly preemptible?: boolean;
  },
): PlayMessage {
  return playMessage.parse({
    type: 'play',
    source,
    ...(options?.loop === undefined ? {} : { loop: options.loop }),
    ...(options?.preemptible === undefined ? {} : { preemptible: options.preemptible }),
  });
}

export function sendDigits(digits: string): SendDigitsMessage {
  return sendDigitsMessage.parse({ type: 'sendDigits', digits });
}

export function switchLanguage(languages: {
  readonly tts?: string;
  readonly transcription?: string;
}): LanguageMessage {
  if (languages.tts === undefined && languages.transcription === undefined) {
    throw new Error('switchLanguage needs at least one of tts or transcription');
  }
  return languageMessage.parse({
    type: 'language',
    ...(languages.tts === undefined ? {} : { ttsLanguage: languages.tts }),
    ...(languages.transcription === undefined
      ? {}
      : { transcriptionLanguage: languages.transcription }),
  });
}

/**
 * End the session, handing `data` to the action URL.
 *
 * `data` must be JSON-serialisable and must not contain personal data: the action-URL payload is
 * provider-side state and appears in the tenant's own Twilio logs (INV-12, and the threat model's
 * "our own telephony account" risk). Outcome codes and reasons, never transcripts or names.
 */
export function end(data: Readonly<Record<string, unknown>>): EndMessage {
  return endMessage.parse({ type: 'end', handoffData: JSON.stringify(data) });
}
