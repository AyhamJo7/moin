/**
 * OpenAI EU adapter contract tests (P10.01.02/.03): recorded responses drive
 * the adapter — EU enforcement, store:false, strict schema, hashed ids,
 * pinned snapshots, and every failure shape. No network (INV-16: synthetic
 * fixtures only). The live staging smoke (nightly) is CI config, not code.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOpenAiAdapter, hashCallerId } from './openai.ts';

const schema = z.strictObject({ intent: z.string(), confidence: z.number() });

const CONFIG = {
  baseUrl: 'https://api.eu-central.openai.example/v1',
  apiKey: 'test-key',
  models: { fast: 'gpt-4o-mini-2024-07-18', strong: 'gpt-4o-2024-08-06' } as const,
};

function request() {
  return {
    tier: 'fast' as const,
    messages: [{ role: 'user' as const, content: 'Ich möchte einen Termin' }],
    schema,
    schemaName: 'intent',
    timeoutMs: 1_500,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('openai adapter', () => {
  it('refuses non-EU endpoints and unconfigured tiers at construction', () => {
    expect(() =>
      createOpenAiAdapter({ ...CONFIG, baseUrl: 'https://api.openai.com/v1' }),
    ).toThrow(RangeError);
    expect(() =>
      createOpenAiAdapter({ ...CONFIG, baseUrl: 'http://api.eu-central.openai.example/v1' }),
    ).toThrow(RangeError);
    expect(() =>
      createOpenAiAdapter({ ...CONFIG, models: { fast: '', strong: 'x' } }),
    ).toThrow(RangeError);
  });

  it('hashes caller ids opaquely and pins the snapshot', async () => {
    expect(hashCallerId('tenant-1')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCallerId('tenant-1')).not.toContain('tenant-1');
    let seen: { url: string; body: Record<string, unknown> } | undefined;
    const adapter = createOpenAiAdapter({
      ...CONFIG,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
        return jsonResponse({
          output_text: JSON.stringify({ intent: 'booking_create', confidence: 0.9 }),
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }) as typeof fetch,
    });
    const result = await adapter.complete(request());
    expect(result.ok).toBe(true);
    expect(seen?.body['model']).toBe('gpt-4o-mini-2024-07-18');
    expect(seen?.body['store']).toBe(false);
    const format = (seen?.body['text'] as { format: { strict: boolean } }).format;
    expect(format.strict).toBe(true);
  });

  it('maps recorded failures: 429, transport, invalid JSON, schema mismatch', async () => {
    const failing = (fetchFn: typeof fetch) =>
      createOpenAiAdapter({ ...CONFIG, fetchFn }).complete(request());
    // 429 with Retry-After.
    const limited = await failing(
      (async () =>
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '2' },
        })) as typeof fetch,
    );
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited', retryAfterMs: 2000 });
    // Provider 500.
    const broken = await failing(
      (async () => jsonResponse({}, 500)) as typeof fetch,
    );
    expect(broken).toMatchObject({ ok: false, reason: 'provider_error' });
    // Non-JSON output.
    const prose = await failing(
      (async () => jsonResponse({ output_text: 'leider nein' })) as typeof fetch,
    );
    expect(prose).toMatchObject({ ok: false, reason: 'invalid_output' });
    // Schema mismatch (missing confidence).
    const mismatch = await failing(
      (async () => jsonResponse({ output_text: JSON.stringify({ intent: 'x' }) })) as typeof fetch,
    );
    expect(mismatch).toMatchObject({ ok: false, reason: 'invalid_output' });
    // Details never carry model output or prompts.
    if (!mismatch.ok && mismatch.reason === 'invalid_output') {
      expect(mismatch.detail ?? '').not.toContain('leider');
    }
  });
});
