/**
 * Pilot monitoring and review cadence (P18.10.01, engineering shapes): daily
 * review queue coverage + weekly report inputs (P15.11 KPIs + ROI shapes).
 * The live slots (founder daily, owner weekly) and the incident card receipt
 * (P18.10.02/.03) ride the founder/owner drill.
 */

export type ReviewItem = 'interactions' | 'incidents' | 'feedback' | 'costs';

export function dailyReviewQueue(): readonly ReviewItem[] {
  return ['interactions', 'incidents', 'feedback', 'costs'];
}

export type ReportInput = 'kpis' | 'roi' | 'incidents' | 'feedback-rate';

/** Weekly report inputs: P15.11 KPIs + ROI + incidents + feedback rate. */
export function weeklyReportInputs(): readonly ReportInput[] {
  return ['kpis', 'roi', 'incidents', 'feedback-rate'];
}

/** True when monitoring covers the daily queue and the report inputs. */
export function monitoringCovers(
  queue: readonly ReviewItem[],
  inputs: readonly ReportInput[],
): boolean {
  for (const item of dailyReviewQueue()) {
    if (!queue.includes(item)) return false;
  }
  for (const input of weeklyReportInputs()) {
    if (!inputs.includes(input)) return false;
  }
  return true;
}
