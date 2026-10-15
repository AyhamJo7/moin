/**
 * Pilot monitoring (P18.10): covers + inputs-present.
 */
import { describe, expect, it } from 'vitest';
import { dailyReviewQueue, monitoringCovers, weeklyReportInputs } from './pilot-monitoring.ts';

describe('pilot monitoring and review cadence', () => {
  it('covers the daily review queue', () => {
    expect(dailyReviewQueue()).toEqual(['interactions', 'incidents', 'feedback', 'costs']);
    expect(monitoringCovers([...dailyReviewQueue()], [...weeklyReportInputs()])).toBe(true);
    expect(monitoringCovers(['interactions'], [...weeklyReportInputs()])).toBe(false);
  });

  it('presents the weekly report inputs', () => {
    expect(weeklyReportInputs()).toEqual(['kpis', 'roi', 'incidents', 'feedback-rate']);
    expect(monitoringCovers([...dailyReviewQueue()], ['kpis'])).toBe(false);
  });
});
