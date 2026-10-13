/**
 * Structured outputs (P10.03.01/.03, LG-V04, FS-08): the provider declaration
 * is generated from the Zod contract; malformed, truncated and extra-field
 * outputs are rejected, never partially used; details carry paths, not output.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createOpenAiAdapter } from './openai.ts';
import { SCHEMA_REJECTIONS, toProviderSchema } from './structured.ts';

const schema = z.strictObject({ intent: z.string(), confidence: z.number() });

const CONFIG = {
  baseUrl: 'https://api.eu-central.openai.example/v1',
  apiKey: 'test-key',
  models: { fast: 'gpt-4o-mini-2024-07-18', strong: 'gpt-4o-2024-08-06' } as const,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function completeWith(outputText: string) {
  const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ output_text: outputText })));
  const adapter = createOpenAiAdapter({ ...CONFIG, fetchFn });
  return adapter.complete({
    tier: 'fast',
    messages: [{ role: 'user', content: 'Termin' }],
    schema,
    schemaName: 'intent',
    timeoutMs: 1_500,
  });
}

describe('structured outputs', () => {
  it('generates the provider schema from the Zod contract', () => {
    expect(toProviderSchema(schema)).toStrictEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { intent: { type: 'string' }, confidence: { type: 'number' } },
      required: ['intent', 'confidence'],
      additionalProperties: false,
    });
  });

  it('names the rejection metric', () => {
    expect(SCHEMA_REJECTIONS).toBe('ai.schema.rejections');
  });

  it('rejects malformed, truncated and extra-field outputs without partial use (FS-08)', async () => {
    // Malformed: prose, not JSON.
    await expect(completeWith('leider nein')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_output',
    });
    // Truncated: valid JSON prefix, missing fields.
    await expect(completeWith('{"intent": "booking_create"')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_output',
    });
    await expect(completeWith(JSON.stringify({ intent: 'booking_create' }))).resolves.toMatchObject(
      { ok: false, reason: 'invalid_output' },
    );
    // Extra field: strict contract refuses it.
    const extra = await completeWith(
      JSON.stringify({ intent: 'booking_create', confidence: 0.9, slot: 'x' }),
    );
    expect(extra).toMatchObject({ ok: false, reason: 'invalid_output' });
    if (!extra.ok) expect(extra).not.toHaveProperty('value');
  });

  it('keeps model output out of the rejection detail (INV-12)', async () => {
    const rejected = await completeWith(
      JSON.stringify({ intent: 'x', confidence: 'Anna Schmidt' }),
    );
    expect(rejected).toMatchObject({ ok: false, reason: 'invalid_output' });
    if (!rejected.ok) {
      expect(rejected.detail).toContain('confidence');
      expect(rejected.detail ?? '').not.toContain('Anna');
    }
  });
});
