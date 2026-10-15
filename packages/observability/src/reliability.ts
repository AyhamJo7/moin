/**
 * Reliability, scale, DR and cost hardening (P31 SELL, engineering shapes):
 * SLO check shapes + scale-target shapes + DR-cost guardrails +
 * load-shedding trigger. Load/soak/game-day reports and live drills ride
 * founder-side staging work; this module is the gate shapes.
 */

/** SLO: voice turn p95 < 1.8 s (ms). */
export const TURN_P95_MS = 1_800;

/** SLO: API p95 reads < 400 ms, writes < 800 ms. */
export const API_READ_P95_MS = 400;
export const API_WRITE_P95_MS = 800;

export interface SloSample {
  readonly turnP95Ms: number;
  readonly apiReadP95Ms: number;
  readonly apiWriteP95Ms: number;
  readonly errorRate: number;
}

/** True when the sample holds every SLO. */
export function sloHolds(sample: SloSample): boolean {
  if (sample.turnP95Ms >= TURN_P95_MS) return false;
  if (sample.apiReadP95Ms >= API_READ_P95_MS) return false;
  if (sample.apiWriteP95Ms >= API_WRITE_P95_MS) return false;
  if (!(sample.errorRate <= 0.005)) return false;
  return true;
}

export interface LoadState {
  readonly queueAgeMs: number;
  readonly dbCpu: number;
}

/** Shed load when the queue ages past 5 min or DB CPU tops 60 %. */
export function shedFires(state: LoadState): boolean {
  return state.queueAgeMs > 300_000 || state.dbCpu > 0.6;
}
