import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeGateway } from './fake.ts';
import type { GatewayRequest } from './port.ts';

const schema = z.strictObject({ intent: z.string(), confidence: z.number() });

function request(): GatewayRequest<z.infer<typeof schema>> {
  return {
    tier: 'fast',
    messages: [{ role: 'user', content: 'Ich möchte einen Termin' }],
    schema,
    schemaName: 'intent',
    timeoutMs: 1_500,
  };
}

describe('the scripted gateway', () => {
  it('returns the scripted value, parsed', async () => {
    const gateway = createFakeGateway({
      script: [{ value: { intent: 'booking_create', confidence: 0.9 }, latencyMs: 120 }],
    });
    const result = await gateway.complete(request());
    expect(result).toStrictEqual({
      ok: true,
      value: { intent: 'booking_create', confidence: 0.9 },
      usage: { inputTokens: 0, outputTokens: 0, model: 'fake' },
      latencyMs: 120,
    });
  });

  // Without this, a test can pass by scripting a shape the production path would reject — which
  // is how a schema change ships green and fails on the first real call.
  it('rejects a scripted value that does not match the caller schema', async () => {
    const gateway = createFakeGateway({ script: [{ value: { intent: 'booking_create' } }] });
    const result = await gateway.complete(request());
    expect(result).toMatchObject({ ok: false, reason: 'invalid_output' });
  });

  it('reports schema paths, never the model output, in the detail', async () => {
    const gateway = createFakeGateway({
      script: [{ value: { intent: 'x', confidence: 'Anna Schmidt' } }],
    });
    const result = await gateway.complete(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toBe('confidence');
      expect(result.detail).not.toContain('Anna');
    }
  });

  it('plays the script in order and then repeats the last answer', async () => {
    const gateway = createFakeGateway({
      script: [
        { value: { intent: 'a', confidence: 1 } },
        { value: { intent: 'b', confidence: 1 } },
      ],
    });
    const first = await gateway.complete(request());
    const second = await gateway.complete(request());
    const third = await gateway.complete(request());
    expect([first, second, third].map((r) => (r.ok ? r.value.intent : 'fail'))).toStrictEqual([
      'a',
      'b',
      'b',
    ]);
  });

  it('can script a failure so callers exercise their fallback', async () => {
    const gateway = createFakeGateway({
      script: [{ failure: { ok: false, reason: 'timeout', latencyMs: 1_500 } }],
    });
    expect(await gateway.complete(request())).toStrictEqual({
      ok: false,
      reason: 'timeout',
      latencyMs: 1_500,
    });
  });

  it('records the requests it was given, so a test can assert the prompt it built', async () => {
    const gateway = createFakeGateway({ script: [{ value: { intent: 'a', confidence: 1 } }] });
    await gateway.complete(request());
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.schemaName).toBe('intent');
    expect(gateway.calls[0]?.tier).toBe('fast');
  });
});
