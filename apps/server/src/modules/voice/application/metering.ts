/**
 * Usage metering (P11.13, INV-20).
 *
 * One ledger row per call and meter — voice_seconds (AI session duration
 * from Twilio), nlu_turns, llm_tokens — keyed by CallSid, written from the
 * call-completed event. Duplicates never double-meter (first write wins, by
 * CallSid + meter). Missing durations resolve via reconciliation (the final
 * duration corrects the row). Pure accumulation here; the billing-module
 * writer and per-tenant aggregation ride separately. Transfers and SMS meter
 * under their own meter names, never folded into voice_seconds.
 */

export type UsageMeter = 'voice_seconds' | 'nlu_turns' | 'llm_tokens' | 'transfer' | 'sms';

export interface UsageRow {
  readonly callSid: string;
  readonly meter: UsageMeter;
  readonly amount: number;
}

export function createMetering(): {
  readonly record: (row: UsageRow) => boolean;
  readonly aggregate: (tenantRows: readonly UsageRow[]) => Readonly<Record<UsageMeter, number>>;
} {
  const seen = new Set<string>();
  return {
    // Returns false when the (CallSid, meter) pair was already recorded.
    record(row: UsageRow): boolean {
      const key = `${row.callSid}|${row.meter}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    aggregate(tenantRows: readonly UsageRow[]): Readonly<Record<UsageMeter, number>> {
      const totals: Record<UsageMeter, number> = {
        voice_seconds: 0,
        nlu_turns: 0,
        llm_tokens: 0,
        transfer: 0,
        sms: 0,
      };
      for (const row of tenantRows) totals[row.meter] += row.amount;
      return totals;
    },
  };
}
