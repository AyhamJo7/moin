/**
 * The model gateway port (ADR-0012, P04.03).
 *
 * ## Why a port exists before any provider does
 *
 * P04's whole purpose is that the riskiest external assumptions get tested early, and the two
 * biggest ones about the model provider are *not* "is it good" but "will we be allowed to use it"
 * and "is it fast enough from Frankfurt". Both are answered by a founder with an account, not by
 * code. What code can do meanwhile is make sure that the answer being "no" costs a day rather than
 * a rewrite — which is what this interface is for.
 *
 * It is deliberately smaller than any provider's SDK. Everything the product actually needs is
 * here; everything else — streaming deltas, assistants, threads, file uploads, vendor-specific
 * tool formats — is absent, because a port that mirrors one provider's surface is that provider's
 * SDK with extra steps, and swapping it is then a rewrite anyway.
 *
 * ## Two model tiers, not model names
 *
 * Callers ask for `fast` or `strong`. A model name in a call site is a name that has to be found
 * and changed in forty places when a provider deprecates it with ninety days' notice — and
 * deprecation notices are the normal case, not an incident. The mapping from tier to model id is
 * configuration, and it is where a provider switch happens.
 *
 * ## Structured output is required, not requested
 *
 * Every call declares the shape it expects and gets it back parsed, or gets a typed failure. There
 * is no "the model returned prose this time" path, because INV-05 says no commitment is made
 * without verified success: a caller that cannot tell malformed output from a refusal will treat
 * one as the other.
 *
 * ## No credentials here
 *
 * INV-04: models hold no credentials and execute nothing. This port carries text and structure,
 * never a token, never a tool it may call directly. Tool execution belongs to the tool guard
 * (P10), on our side of the boundary, after validation.
 */

import type { ZodType } from 'zod';

/** Which class of model to use. The mapping to a provider model id is configuration. */
export type ModelTier = 'fast' | 'strong';

export interface GatewayMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface GatewayRequest<T> {
  readonly tier: ModelTier;
  readonly messages: readonly GatewayMessage[];
  /** The shape the answer must have. Validated before the caller sees anything. */
  readonly schema: ZodType<T>;
  /** A name for the schema, for provider-side strict-output declarations and for telemetry. */
  readonly schemaName: string;
  /**
   * Hard deadline. A voice turn that takes four seconds has already failed, so the gateway is
   * given the budget rather than a default, and the caller decides what to do with the timeout.
   */
  readonly timeoutMs: number;
  /**
   * Idempotency key for a retried call (INV-11). Two attempts with the same key must not count
   * twice against the usage ledger (INV-20).
   */
  readonly idempotencyKey?: string;
}

/** What a call cost, for the usage ledger that billing derives from (INV-20). */
export interface GatewayUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}

export interface GatewaySuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly usage: GatewayUsage;
  /** Wall-clock time for the whole call, measured by the gateway, not reported by the provider. */
  readonly latencyMs: number;
}

/**
 * Why a call did not produce a value.
 *
 * These are cases the caller must handle differently, which is why they are a union rather than
 * one error class with a message:
 *
 *   - `timeout` — the deadline passed. In a voice turn, say something and move on.
 *   - `rate_limited` — back off; `retryAfterMs` when the provider said.
 *   - `invalid_output` — the model answered in the wrong shape. Not retryable by repeating the
 *     same request, and never to be papered over: INV-08 answers come from approved knowledge in
 *     a known shape, or they do not go out.
 *   - `refused` — the model declined. A product decision, not an error to retry.
 *   - `provider_error` — anything else, including transport failure.
 */
export type GatewayFailureReason =
  'timeout' | 'rate_limited' | 'invalid_output' | 'refused' | 'provider_error';

export interface GatewayFailure {
  readonly ok: false;
  readonly reason: GatewayFailureReason;
  readonly latencyMs: number;
  readonly retryAfterMs?: number;
  /**
   * A short, log-safe description: provider status codes and schema paths, never model output and
   * never the prompt (INV-12). Anything derived from what a caller said is personal data.
   */
  readonly detail?: string;
}

export type GatewayResult<T> = GatewaySuccess<T> | GatewayFailure;

export interface ModelGateway {
  complete<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>>;
}
