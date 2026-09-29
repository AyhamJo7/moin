/**
 * A gateway that answers from a script (P04.03, and every test that follows it).
 *
 * The feasibility spike speaks only scripted lines — no model wording reaches a real caller
 * (PLAN P04, AI safety). Beyond the spike, every test of a dialogue, a tool call or a fallback
 * needs a model that is deterministic, instant and free, or those tests will be slow, flaky and
 * billed.
 *
 * It validates against the caller's schema like a real provider would, so a test cannot pass by
 * returning a shape the production path would reject.
 */

import type { GatewayRequest, GatewayResult, GatewayUsage, ModelGateway } from './port.ts';

export interface ScriptedAnswer {
  /** Returned as the parsed value after validation against the caller's schema. */
  readonly value: unknown;
  readonly latencyMs?: number;
  readonly usage?: Partial<GatewayUsage>;
}

export type ScriptedOutcome = ScriptedAnswer | { readonly failure: GatewayResult<never> };

export interface FakeGatewayOptions {
  /** Answers are taken in order; the last one repeats once the script runs out. */
  readonly script: readonly ScriptedOutcome[];
}

const DEFAULT_USAGE: GatewayUsage = { inputTokens: 0, outputTokens: 0, model: 'fake' };

export function createFakeGateway(options: FakeGatewayOptions): ModelGateway & {
  readonly calls: readonly GatewayRequest<unknown>[];
} {
  const calls: GatewayRequest<unknown>[] = [];
  let index = 0;

  return {
    get calls(): readonly GatewayRequest<unknown>[] {
      return calls;
    },
    complete<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
      calls.push(request);
      const outcome = options.script[Math.min(index, options.script.length - 1)];
      index += 1;
      if (outcome === undefined) {
        return Promise.resolve({
          ok: false,
          reason: 'provider_error',
          latencyMs: 0,
          detail: 'the fake gateway has no scripted answer',
        });
      }
      if ('failure' in outcome) {
        return Promise.resolve(outcome.failure as GatewayResult<T>);
      }

      // Validated exactly as a provider's answer would be, so a test cannot pass with a shape the
      // production path rejects.
      const parsed = request.schema.safeParse(outcome.value);
      if (!parsed.success) {
        return Promise.resolve({
          ok: false,
          reason: 'invalid_output',
          latencyMs: outcome.latencyMs ?? 0,
          detail: parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', '),
        });
      }
      return Promise.resolve({
        ok: true,
        value: parsed.data,
        usage: { ...DEFAULT_USAGE, ...outcome.usage },
        latencyMs: outcome.latencyMs ?? 0,
      });
    },
  };
}
