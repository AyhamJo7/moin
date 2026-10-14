/**
 * Founder KPI dashboard (P15.11.01): KPI shapes — calls handled, resolution
 * rate, callback SLA, cost per call — plus the dashboard aggregation over
 * caller-supplied counts. Counts only, never caller content (INV-12). Pure;
 * the reporting views and the weekly export ride separately.
 */

export interface KpiCounts {
  readonly callsHandled: number;
  readonly callsTotal: number;
  readonly resolved: number;
  readonly callbacksOnTime: number;
  readonly callbacksTotal: number;
  readonly costMicros: number;
}

export interface KpiDashboard {
  readonly handledShare: number;
  readonly resolutionRate: number;
  readonly callbackSla: number;
  readonly costPerCallMicros: number;
}

/** Aggregate counts into dashboard ratios; zero-safe (no division by zero). */
export function aggregateKpis(counts: KpiCounts): KpiDashboard {
  for (const [name, value] of Object.entries(counts)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite number ≥ 0`);
    }
  }
  return {
    handledShare: counts.callsTotal === 0 ? 0 : counts.callsHandled / counts.callsTotal,
    resolutionRate: counts.callsHandled === 0 ? 0 : counts.resolved / counts.callsHandled,
    callbackSla: counts.callbacksTotal === 0 ? 0 : counts.callbacksOnTime / counts.callbacksTotal,
    costPerCallMicros: counts.callsHandled === 0 ? 0 : counts.costMicros / counts.callsHandled,
  };
}
