/**
 * Decoding and encoding ConversationRelay frames (P04.04.02).
 *
 * ## Decoding never throws
 *
 * A thrown decode error inside a WebSocket message handler is an unhandled rejection away from
 * killing the connection, and a killed connection is a dropped call. INV-19 says a call is never
 * dropped silently, so the failure mode here is a *value*: every frame produces one of three
 * outcomes the caller must handle, and the type system makes forgetting one a compile error.
 *
 *   - `message` — understood; act on it.
 *   - `unknown` — a type this version does not know. Log the type and continue. A provider adding
 *     a message must not end a call.
 *   - `invalid` — a known type whose required fields are wrong. Log and continue, but this is a
 *     defect in us or a change in the provider, and it should page someone in aggregate.
 *
 * ## Failures carry no content
 *
 * `voicePrompt` is what a caller said: a name, an address, sometimes a medical reason for a
 * booking. INV-12 keeps personal data out of logs, and a decode error is exactly where it usually
 * escapes, because validation libraries quote the offending value by default.
 *
 * So `invalid.reason` is built from issue *paths and codes only* — never `issue.message`, which
 * embeds received values, and never the input. The result is less convenient to debug and is the
 * only version that can be logged at all.
 */

import type { ZodError } from 'zod';
import { inboundMessage, KNOWN_INBOUND_TYPES, type InboundMessage } from './inbound.ts';
import { outboundMessage, type OutboundMessage } from './outbound.ts';

export type DecodeResult =
  | { readonly kind: 'message'; readonly message: InboundMessage }
  | { readonly kind: 'unknown'; readonly type: string }
  | { readonly kind: 'invalid'; readonly type: string | undefined; readonly reason: string };

/** Builds a log-safe reason: field paths and issue codes, never received values. */
function describeIssues(error: ZodError): string {
  const parts = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length === 0 ? '(root)' : issue.path.join('.');
    return `${path}: ${issue.code}`;
  });
  const more = error.issues.length > parts.length ? `, +${error.issues.length - parts.length}` : '';
  return parts.join(', ') + more;
}

function readType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const type: unknown = (value as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : undefined;
}

/**
 * Decodes one WebSocket frame.
 *
 * Accepts the string or bytes a WebSocket delivers, because a handler that has to remember to
 * decode UTF-8 first is a handler that will forget once.
 */
export function decodeInbound(frame: string | Uint8Array): DecodeResult {
  let raw: string;
  if (typeof frame === 'string') {
    raw = frame;
  } else {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(frame);
    } catch {
      return { kind: 'invalid', type: undefined, reason: 'frame is not valid UTF-8' };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', type: undefined, reason: 'frame is not valid JSON' };
  }

  const type = readType(parsed);
  if (type === undefined) {
    return { kind: 'invalid', type: undefined, reason: 'frame has no string "type" field' };
  }
  if (!KNOWN_INBOUND_TYPES.includes(type)) {
    return { kind: 'unknown', type };
  }

  const result = inboundMessage.safeParse(parsed);
  if (!result.success) {
    return { kind: 'invalid', type, reason: describeIssues(result.error) };
  }
  return { kind: 'message', message: result.data };
}

/**
 * Encodes an outbound message.
 *
 * Validated on the way out even though the constructors in `outbound.ts` already validated: this
 * is the only function that produces bytes, and an object assembled by hand somewhere else would
 * otherwise reach the wire unchecked.
 */
export function encodeOutbound(message: OutboundMessage): string {
  return JSON.stringify(outboundMessage.parse(message));
}
