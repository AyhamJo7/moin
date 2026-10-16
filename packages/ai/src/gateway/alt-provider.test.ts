/**
 * Alternative EU provider (P10.02 LAUNCH): contract-parity + switch-gated.
 */
import { describe, expect, it } from 'vitest';
import { ALT_EVAL_SCHEMA, altProviderEnabled, createAltGateway } from './alt-provider.ts';

describe('alternative eu provider', () => {
  it('matches the ModelGateway contract', async () => {
    const gateway = createAltGateway();
    const result = await gateway.complete({
      tier: 'fast',
      messages: [],
      schema: ALT_EVAL_SCHEMA,
      schemaName: 'alt-eval',
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage.model).toBe('eu-alternative');
  });

  it('gates the switch on flag + eval report', () => {
    expect(altProviderEnabled(true, 'eval-1')).toBe(true);
    expect(altProviderEnabled(false, 'eval-1')).toBe(false);
    expect(altProviderEnabled(true, null)).toBe(false);
    expect(altProviderEnabled(true, '  ')).toBe(false);
  });
});
