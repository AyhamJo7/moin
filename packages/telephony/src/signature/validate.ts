/**
 * `X-Twilio-Signature` validation (P04.04.03).
 *
 * This is the only thing standing between our voice endpoint and anyone on the internet who knows
 * the URL. Everything downstream — starting a session, reading back a booking, ending a call —
 * trusts that the request came from Twilio because this function said so.
 *
 * ## The scheme
 *
 * Twilio builds a base string from the full request URL, then for a form-encoded POST appends each
 * parameter as `name + value` in ascending order of name, and signs it with HMAC-SHA1 keyed by the
 * account auth token, base64-encoded. For a JSON body there are no form parameters; Twilio instead
 * appends a `bodySHA256` query parameter to the URL, and the body is verified by hashing it.
 *
 * Both halves are required for a JSON webhook. Verifying the signature alone leaves the body
 * unauthenticated — the URL is signed, the body is not — so `validateJsonWebhook` checks the hash
 * as well, and a caller that only wants the signature has to ask for it by name.
 *
 * ## Comparison
 *
 * Both sides are hashed to a fixed 32 bytes before `timingSafeEqual`. Comparing the base64 strings
 * directly needs a length check first, and an early return on length is a branch on attacker input
 * inside a signature check — a small leak, but exactly the kind that this code exists to not have.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureInput {
  /** The Twilio auth token for the account the request claims to come from. */
  readonly authToken: string;
  /** The absolute URL Twilio requested — see `reconstructRequestUrl`. */
  readonly url: string;
  /** The value of the `X-Twilio-Signature` header. */
  readonly signature: string;
  /** Form parameters, for `application/x-www-form-urlencoded` requests. Empty for JSON. */
  readonly params?: Readonly<Record<string, string>> | undefined;
}

/** Builds Twilio's signature base string. Exported because the fixtures assert it directly. */
export function signatureBaseString(
  url: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const names = Object.keys(params).sort();
  let base = url;
  for (const name of names) {
    base += name + (params[name] ?? '');
  }
  return base;
}

/** The expected signature for a request. Exported so tests can build valid fixtures honestly. */
export function computeSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>> = {},
): string {
  return createHmac('sha1', authToken)
    .update(signatureBaseString(url, params), 'utf8')
    .digest('base64');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * Validates the signature over the URL and form parameters.
 *
 * Returns a boolean rather than throwing: the caller's job is to answer `403` and log, and an
 * exception type here would only be unwrapped into that same boolean one frame up.
 */
export function isValidSignature(input: SignatureInput): boolean {
  if (input.authToken === '' || input.signature === '') {
    return false;
  }
  const expected = computeSignature(input.authToken, input.url, input.params ?? {});
  return constantTimeEquals(expected, input.signature);
}

/** Verifies that a raw JSON body matches the `bodySHA256` value Twilio put in the URL. */
export function isValidBodyHash(rawBody: string | Uint8Array, expectedHex: string): boolean {
  if (expectedHex === '') {
    return false;
  }
  const actual = createHash('sha256')
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody))
    .digest('hex');
  return constantTimeEquals(actual, expectedHex.toLowerCase());
}

export type WebhookVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        'missing-signature' | 'bad-signature' | 'bad-body-hash' | 'missing-body-hash';
    };

/**
 * Validates a JSON webhook: signature over the URL, **and** the body hash the URL commits to.
 *
 * A missing `bodySHA256` is a failure, not a skip. Treating it as optional means an attacker who
 * can replay a signed URL can attach any body they like to it.
 */
export function validateJsonWebhook(input: {
  readonly authToken: string;
  readonly url: string;
  readonly signature: string | undefined;
  readonly rawBody: string | Uint8Array;
}): WebhookVerdict {
  if (input.signature === undefined || input.signature === '') {
    return { ok: false, reason: 'missing-signature' };
  }
  if (
    !isValidSignature({ authToken: input.authToken, url: input.url, signature: input.signature })
  ) {
    return { ok: false, reason: 'bad-signature' };
  }
  const expectedHex = new URL(input.url).searchParams.get('bodySHA256');
  if (expectedHex === null || expectedHex === '') {
    return { ok: false, reason: 'missing-body-hash' };
  }
  if (!isValidBodyHash(input.rawBody, expectedHex)) {
    return { ok: false, reason: 'bad-body-hash' };
  }
  return { ok: true };
}

/**
 * Validates a form-encoded webhook (the shape Twilio uses for voice status callbacks and for the
 * `<Connect action>` result).
 */
export function validateFormWebhook(input: {
  readonly authToken: string;
  readonly url: string;
  readonly signature: string | undefined;
  readonly params: Readonly<Record<string, string>>;
}): WebhookVerdict {
  if (input.signature === undefined || input.signature === '') {
    return { ok: false, reason: 'missing-signature' };
  }
  const ok = isValidSignature({
    authToken: input.authToken,
    url: input.url,
    signature: input.signature,
    params: input.params,
  });
  return ok ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
