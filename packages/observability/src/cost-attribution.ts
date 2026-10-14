/**
 * Cost monitoring and per-tenant attribution (P15.12.01/.02): rollup of
 * voice minutes, LLM micros and SMS counts into per-tenant micros, plus the
 * 2× trailing-average anomaly flag. Counts and rates only, never caller
 * content (INV-12). Pure; the nightly job and the bill reconciliation ride
 * separately.
 */

export interface TenantUsage {
  readonly tenantId: string;
  readonly voiceMinutes: number;
  readonly llmMicros: number;
  readonly smsCount: number;
}

export interface CostRates {
  readonly voiceMicrosPerMinute: number;
  readonly smsMicrosEach: number;
}

/** Per-tenant cost in micros: voice + LLM + SMS. */
export function tenantCostMicros(usage: TenantUsage, rates: CostRates): number {
  const inputs: Readonly<Record<string, unknown>> = { ...usage, ...rates };
  for (const [name, value] of Object.entries(inputs)) {
    if (name === 'tenantId') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite number ≥ 0`);
    }
  }
  return (
    usage.voiceMinutes * rates.voiceMicrosPerMinute +
    usage.llmMicros +
    usage.smsCount * rates.smsMicrosEach
  );
}

/** Sum per-tenant costs into the fleet total (attribution sums). */
export function attributionTotal(costs: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const cost of Object.values(costs)) {
    if (!Number.isFinite(cost) || cost < 0) throw new RangeError('costs must be finite ≥ 0');
    total += cost;
  }
  return total;
}

/** True when the tenant cost exceeds 2× its trailing average (P15.12.02). */
export function costAnomaly(costMicros: number, trailingAverageMicros: number): boolean {
  if (!Number.isFinite(costMicros) || costMicros < 0) throw new RangeError('cost must be ≥ 0');
  if (!Number.isFinite(trailingAverageMicros) || trailingAverageMicros < 0) {
    throw new RangeError('average must be ≥ 0');
  }
  if (trailingAverageMicros === 0) return costMicros > 0;
  return costMicros > 2 * trailingAverageMicros;
}
