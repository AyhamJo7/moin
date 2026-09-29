/**
 * Messages ConversationRelay sends us over the WebSocket (P04.04.02).
 *
 * ## Why these schemas are loose
 *
 * Each schema requires the fields we act on and accepts everything else. That is the opposite of
 * the usual advice, and it is deliberate: this is an inbound boundary we do not control, on a
 * transport that carries a live phone call. If Twilio adds a field to `prompt` next Tuesday, a
 * strict schema turns every call into a decode failure — and INV-19 says a call is never dropped
 * silently. Rejecting an unrecognised *shape* buys us nothing, because we only read the fields we
 * named; rejecting an unrecognised *type* is handled separately, by ignoring it.
 *
 * The validation that does matter is on the fields we branch on. `dtmf.digit` reaching the
 * dialogue layer as `undefined` is a bug that will be found in production, on a caller pressing
 * `2` to confirm a cancellation.
 *
 * ## The field names are unverified
 *
 * They follow PLAN P04.04.02 and Twilio's published protocol. No live ConversationRelay session
 * has run against them — that is P04.04.06, blocked on EXT-10 and EXT-11. The looseness above is
 * what makes that acceptable to ship now: a field we named wrongly shows up as a decode failure on
 * one message type, not as a broken call.
 */

import { z } from 'zod';

const nonEmpty = z.string().min(1);

/**
 * `setup` — the first message of a session. Carries the call identifiers and the
 * `<Parameter>` values from the TwiML, which is where the session token arrives.
 */
export const setupMessage = z.looseObject({
  type: z.literal('setup'),
  sessionId: nonEmpty,
  callSid: nonEmpty,
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.string().optional(),
  customParameters: z.record(z.string(), z.string()).optional(),
});

/** `prompt` — a transcribed caller utterance. `last` marks the end of a final result. */
export const promptMessage = z.looseObject({
  type: z.literal('prompt'),
  voicePrompt: z.string(),
  lang: z.string().optional(),
  last: z.boolean().optional(),
});

/** `interrupt` — the caller spoke over the assistant; what had been said is reported back. */
export const interruptMessage = z.looseObject({
  type: z.literal('interrupt'),
  utteranceUntilInterrupt: z.string().optional(),
  durationUntilInterruptMs: z.union([z.number(), z.string()]).optional(),
});

/** `dtmf` — a keypress. The one inbound field we branch on for irreversible actions. */
export const dtmfMessage = z.looseObject({
  type: z.literal('dtmf'),
  digit: nonEmpty,
});

/** `error` — the provider reporting a problem with the session. */
export const errorMessage = z.looseObject({
  type: z.literal('error'),
  description: z.string().optional(),
});

export const inboundMessage = z.discriminatedUnion('type', [
  setupMessage,
  promptMessage,
  interruptMessage,
  dtmfMessage,
  errorMessage,
]);

export type SetupMessage = z.infer<typeof setupMessage>;
export type PromptMessage = z.infer<typeof promptMessage>;
export type InterruptMessage = z.infer<typeof interruptMessage>;
export type DtmfMessage = z.infer<typeof dtmfMessage>;
export type ErrorMessage = z.infer<typeof errorMessage>;
export type InboundMessage = z.infer<typeof inboundMessage>;

/** The message types this version understands, for logging what was ignored and why. */
export const KNOWN_INBOUND_TYPES: readonly string[] = [
  'setup',
  'prompt',
  'interrupt',
  'dtmf',
  'error',
];
