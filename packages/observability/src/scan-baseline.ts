/**
 * Security scanning baseline and triage (P17.07.01/.02, engineering shapes):
 * severity buckets + triage states + SLA clocks. The live scanners (ZAP
 * nightly, LG-P06 record) ride the staging verification.
 */

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low';
export type TriageState = 'open' | 'triaged' | 'excepted' | 'fixed';

export interface ScanFinding {
  readonly severity: ScanSeverity;
  readonly state: TriageState;
  readonly ageDays: number;
}

/** SLA clock in days per severity (critical 1, high 7, medium 30, low 90). */
export function triageSlaDays(severity: ScanSeverity): number {
  if (severity === 'critical') return 1;
  if (severity === 'high') return 7;
  if (severity === 'medium') return 30;
  return 90;
}

/** True when the finding is within its triage SLA (or already resolved). */
export function baselineHolds(finding: ScanFinding): boolean {
  if (finding.state === 'fixed') return true;
  if (finding.state === 'excepted') return finding.severity === 'low';
  if (!Number.isFinite(finding.ageDays) || finding.ageDays < 0) return false;
  return finding.ageDays <= triageSlaDays(finding.severity);
}
