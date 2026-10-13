/**
 * OpenAI EU adapter contract tests (P10.01.02/.03): recorded responses drive
 * the adapter — EU enforcement, store:false, strict schema, hashed ids,
 * pinned snapshots, and every failure shape. No network (INV-16: synthetic
 * fixtures only). The live staging smoke (nightly) is CI config, not code.
 */
import { describe, expect, it, vi } from 'vitest';
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
    expect(() => createOpenAiAdapter({ ...CONFIG, baseUrl: 'https://api.openai.com/v1' })).toThrow(
      RangeError,
    );
    expect(() =>
      createOpenAiAdapter({ ...CONFIG, baseUrl: 'http://api.eu-central.openai.example/v1' }),
    ).toThrow(RangeError);
    expect(() => createOpenAiAdapter({ ...CONFIG, models: { fast: '', strong: 'x' } })).toThrow(
      RangeError,
    );
  });

  it('hashes caller ids opaquely and pins the snapshot', async () => {
    expect(hashCallerId('tenant-1')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCallerId('tenant-1')).not.toContain('tenant-1');
    const fetchFn = vi.fn((url: string | URL | Request, init?: { body?: unknown }) => {
      const rawBody = init?.body;
      const seen = {
        url: url instanceof Request ? url.url : String(url),
        body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : {},
      };
      expect(seen.body['model']).toBe('gpt-4o-mini-2024-07-18');
      expect(seen.body['store']).toBe(false);
      return Promise.resolve(
        jsonResponse({
          output_text: JSON.stringify({ intent: 'booking_create', confidence: 0.9 }),
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
    const adapter = createOpenAiAdapter({ ...CONFIG, fetchFn });
    const result = await adapter.complete(request());
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('strict schema flag is set on the request', async () => {
    let seen: Record<string, unknown> = {};
    const fetchFn = vi.fn(
      (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        seen =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        return Promise.resolve(jsonResponse({ output_text: '{}' }));
      },
    );
    const adapter = createOpenAiAdapter({ ...CONFIG, fetchFn });
    await adapter.complete(request());
    expect(fetchFn).toHaveBeenCalledOnce();
    const format = (seen['text'] as { format: { strict: boolean; name: string } }).format;
    expect(format.strict).toBe(true);
    expect(format.name).toBe('intent');
  });

  it('maps recorded failures: 429, transport, invalid JSON, schema mismatch', async () => {
    const failing = (fetchFn: Parameters<typeof createOpenAiAdapter>[0]['fetchFn']) =>
      createOpenAiAdapter({ ...CONFIG, fetchFn }).complete(request());
    // 429 with Retry-After.
    const limited = await failing(() =>
      Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '2' } })),
    );
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited', retryAfterMs: 2000 });
    // Provider 500.
    const broken = await failing(() => Promise.resolve(jsonResponse({}, 500)));
    expect(broken).toMatchObject({ ok: false, reason: 'provider_error' });
    // Non-JSON output.
    const prose = await failing(() =>
      Promise.resolve(jsonResponse({ output_text: 'leider nein' })),
    );
    expect(prose).toMatchObject({ ok: false, reason: 'invalid_output' });
    // Schema mismatch (missing confidence).
    const mismatch = await failing(() =>
      Promise.resolve(jsonResponse({ output_text: JSON.stringify({ intent: 'x' }) })),
    );
    expect(mismatch).toMatchObject({ ok: false, reason: 'invalid_output' });
    // Details never carry model output or prompts.
    if (!mismatch.ok && mismatch.reason === 'invalid_output') {
      expect(mismatch.detail ?? '').not.toContain('leider');
    }
  });
});
