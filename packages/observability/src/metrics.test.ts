/**
 * Metrics catalogue (P15.02.01/.03): catalogue-complete, dashboards pinned.
 */
import { describe, expect, it } from 'vitest';
import { dashboardMetrics, isKnownMetric, METRIC_CATALOGUE } from './metrics.ts';

describe('metrics catalogue', () => {
  it('holds the required names as stable API', () => {
    for (const name of [
      'faq.resolved',
      'knowledge.suspended',
      'ai.calls',
      'ai.latency',
      'tools.proposed',
      'tools.executed',
      'jobs.failures',
      'jobs.duration',
      'sqs.depth',
      'owner.feedback',
      'notify.sent',
      'escalation.unacknowledged',
    ]) {
      expect(isKnownMetric(name), `${name} must be catalogued`).toBe(true);
    }
    expect(isKnownMetric('user.phone.number')).toBe(false);
    expect(new Set(METRIC_CATALOGUE).size).toBe(METRIC_CATALOGUE.length);
  });

  it('pins dashboards 1–6 to catalogue metrics only', () => {
    for (let dashboard = 1; dashboard <= 6; dashboard++) {
      const metrics = dashboardMetrics(dashboard);
      expect(metrics.length).toBeGreaterThan(0);
      for (const metric of metrics) expect(isKnownMetric(metric)).toBe(true);
    }
    expect(() => dashboardMetrics(0)).toThrow(RangeError);
    expect(() => dashboardMetrics(7)).toThrow(RangeError);
  });
});
