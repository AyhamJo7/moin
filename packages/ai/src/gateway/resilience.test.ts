/**
 * Gateway resilience (P10.04.01/.02/.04, FS-02): purpose deadlines win over
 * the caller budget; retryable failures retry, invalid_output/refused do not;
 * 5 failures in 30 s open the breaker for 60 s, then a half-open probe goes
 * through; per-call token cap is exported for callers.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeGateway } from './fake.ts';
import type { GatewayRequest } from './port.ts';
import {
  MAX_INPUT_TOKENS_PER_CALL,
  PURPOSE_POLICIES,
  resetBreakers,
  withResilience,
} from './resilience.ts';

const schema = z.strictObject({ intent: z.string() });

function request(timeoutMs = 5_000): GatewayRequest<{ intent: string }> {
  return {
    tier: 'fast',
    messages: [{ role: 'user', content: 'Termin' }],
    schema,
    schemaName: 'intent',
    timeoutMs,
  };
}

describe('gateway resilience', () => {
  it('caps the caller budget at the purpose deadline', async () => {
    resetBreakers();
    const inner = createFakeGateway({ script: [{ value: { intent: 'a' } }] });
    const gateway = withResilience(inner, { purpose: 'voice-nlu', scope: 'test-deadline' });
    await gateway.complete(request(5_000));
    expect(inner.calls[0]?.timeoutMs).toBe(900);
    expect(PURPOSE_POLICIES['voice-nlu']).toStrictEqual({ timeoutMs: 900, maxRetries: 1 });
  });

  it('retries timeouts, never invalid_output or refusals', async () => {
    resetBreakers();
    const flaky = withResilience(
      createFakeGateway({
        script: [
          { failure: { ok: false, reason: 'timeout', latencyMs: 900 } },
          { value: { intent: 'recovered' } },
        ],
      }),
      { purpose: 'voice-nlu', scope: 'test-retry' },
    );
    const recovered = await flaky.complete(request());
    expect(recovered).toMatchObject({ ok: true, value: { intent: 'recovered' } });

    const badShape = withResilience(createFakeGateway({ script: [{ value: { wrong: 1 } }] }), {
      purpose: 'voice-nlu',
      scope: 'test-no-retry-invalid',
    });
    expect(await badShape.complete(request())).toMatchObject({
      ok: false,
      reason: 'invalid_output',
    });

    const refused = withResilience(
      createFakeGateway({ script: [{ failure: { ok: false, reason: 'refused', latencyMs: 1 } }] }),
      { purpose: 'voice-nlu', scope: 'test-no-retry-refused' },
    );
    expect(await refused.complete(request())).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('opens the breaker after 5 failures and half-open probes after 60 s (FS-02)', async () => {
    resetBreakers();
    let at = 0;
    const now = (): number => at;
    const failing = (): ReturnType<typeof createFakeGateway> =>
      createFakeGateway({ script: [{ failure: { ok: false, reason: 'timeout', latencyMs: 1 } }] });
    const scope = 'test-breaker';
    // 5 failures inside the 30 s window open the breaker.
    for (let i = 0; i < 5; i += 1) {
      at = i * 1_000;
      const r = await withResilience(failing(), { purpose: 'voice-nlu', scope, now }).complete(
        request(),
      );
      expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    }
    // Open: the inner gateway is never reached.
    at = 5_000;
    const open = await withResilience(failing(), {
      purpose: 'voice-nlu',
      scope,
      now,
    }).complete(request());
    expect(open).toMatchObject({
      ok: false,
      reason: 'provider_error',
      detail: expect.stringContaining('circuit open'),
    });
    // After 60 s the half-open probe goes through (and fails again here).
    at = 65_001;
    const probe = await withResilience(failing(), {
      purpose: 'voice-nlu',
      scope,
      now,
    }).complete(request());
    expect(probe).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('exports the per-call token cap for callers (P10.04.03)', () => {
    expect(MAX_INPUT_TOKENS_PER_CALL).toBe(8_000);
  });
});
