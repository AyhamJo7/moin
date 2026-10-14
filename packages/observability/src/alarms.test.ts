/**
 * Alarms and routing (P15.04): threshold-shapes + routing-resolves.
 */
import { describe, expect, it } from 'vitest';
import { alarmThresholds, routeAlarm } from './alarms.ts';

describe('alarms and on-call routing', () => {
  it('shapes every threshold with severity and runbook', () => {
    const thresholds = alarmThresholds();
    const metrics = thresholds.map((t) => t.metric);
    for (const metric of ['outbox.lag', 'sqs.dlq.depth', 'escalation.unacknowledged']) {
      expect(metrics).toContain(metric);
    }
    for (const threshold of thresholds) {
      expect(['SEV1', 'SEV2', 'SEV3']).toContain(threshold.severity);
      expect(threshold.runbook.startsWith('docs/runbooks/')).toBe(true);
    }
  });

  it('resolves routing: SEV1 all channels, secondary only when one exists', () => {
    expect(routeAlarm('SEV1', true)).toEqual({
      severity: 'SEV1',
      channels: ['sms', 'push', 'email'],
      secondary: true,
    });
    expect(routeAlarm('SEV1', false).secondary).toBe(false);
    expect(routeAlarm('SEV2', true).channels).toEqual(['push', 'email']);
    expect(routeAlarm('SEV3', true)).toEqual({
      severity: 'SEV3',
      channels: ['email'],
      secondary: false,
    });
  });
});
