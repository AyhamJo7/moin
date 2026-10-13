/**
 * Cost telemetry (P10.14.01/.02, INV-20): integer-micros pricing from a
 * config table; ledger rows metered llm_tokens for margin, not billing.
 */
import { describe, expect, it } from 'vitest';
import { costMicros, ledgerEntry } from './cost.ts';
import type { PriceTable } from './cost.ts';

const PRICES: PriceTable = {
  inputPer1k: { 'gpt-4o-mini-2024-07-18': 150 },
  outputPer1k: { 'gpt-4o-mini-2024-07-18': 600 },
};

describe('cost telemetry', () => {
  it('prices a call in integer micros from the config table', () => {
    expect(
      costMicros({ inputTokens: 1000, outputTokens: 500, model: 'gpt-4o-mini-2024-07-18' }, PRICES),
    ).toBe(150 + 300);
    expect(
      costMicros({ inputTokens: 10, outputTokens: 5, model: 'gpt-4o-mini-2024-07-18' }, PRICES),
    ).toBeGreaterThan(0);
  });

  it('unknown models cost 0, never NaN', () => {
    expect(costMicros({ inputTokens: 1000, outputTokens: 1000, model: 'nope' }, PRICES)).toBe(0);
  });

  it('ledger rows meter llm_tokens for margin, not billing', () => {
    const entry = ledgerEntry(
      'tenant-a',
      'call-1',
      {
        inputTokens: 1000,
        outputTokens: 500,
        model: 'gpt-4o-mini-2024-07-18',
      },
      PRICES,
    );
    expect(entry).toStrictEqual({
      meter: 'llm_tokens',
      tenantId: 'tenant-a',
      interactionId: 'call-1',
      model: 'gpt-4o-mini-2024-07-18',
      inputTokens: 1000,
      outputTokens: 500,
      costMicros: 450,
    });
  });
});
