/**
 * Cost and token telemetry (P10.14.01/.02, INV-20).
 *
 * `costMicros` turns provider usage (input/output tokens) into micro-credits
 * via a price table that is configuration (T-17), not code. `ledgerEntry`
 * shapes the `llm_tokens` usage-ledger row: margin tracking, never customer
 * billing (INV-20). The dashboard (P10.14.03) and the invoice reconciliation
 * (P10.14.04) read the ledger; they ride separately — this module computes
 * the row, it does not store or display it.
 *
 * Money is integer micros throughout: no floats cross this boundary, so
 * there is no rounding to get wrong.
 */

export interface PriceTable {
  /** Micro-credits per 1k input tokens, per model id. */
  readonly inputPer1k: Readonly<Record<string, number>>;
  readonly outputPer1k: Readonly<Record<string, number>>;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}

/** Integer micro-credits for one call; unknown models cost 0, never NaN. */
export function costMicros(usage: TokenUsage, prices: PriceTable): number {
  const inputRate = prices.inputPer1k[usage.model] ?? 0;
  const outputRate = prices.outputPer1k[usage.model] ?? 0;
  return (
    Math.ceil((usage.inputTokens * inputRate) / 1000) +
    Math.ceil((usage.outputTokens * outputRate) / 1000)
  );
}

export interface LlmLedgerEntry {
  readonly meter: 'llm_tokens';
  readonly tenantId: string;
  readonly interactionId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
}

export function ledgerEntry(
  tenantId: string,
  interactionId: string,
  usage: TokenUsage,
  prices: PriceTable,
): LlmLedgerEntry {
  return {
    meter: 'llm_tokens',
    tenantId,
    interactionId,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costMicros: costMicros(usage, prices),
  };
}
