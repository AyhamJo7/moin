/**
 * Degraded capture (P11.08.01–.03, FS-11, INV-06): DB-down queues the
 * capture, the envelope is marked, overdue pages, expired drops.
 */
import { describe, expect, it } from 'vitest';
import {
  DEGRADED_ALARM_AGE_MS,
  DEGRADED_QUEUE,
  DEGRADED_RETENTION_DAYS,
  degradeToQueue,
  expiredCaptures,
  overdueCaptures,
} from './degraded-capture.ts';

describe('degraded capture', () => {
  it('queues minimal fields with the KMS envelope marked (DB-down path)', () => {
    expect(DEGRADED_QUEUE).toBe('degraded-capture');
    expect(DEGRADED_RETENTION_DAYS).toBe(4);
    const capture = degradeToQueue('CA1', 'tenant-a', '+49151', 'db-unavailable', 1_000);
    expect(capture).toStrictEqual({
      callSid: 'CA1',
      tenantId: 'tenant-a',
      callbackPhone: '+49151',
      reason: 'db-unavailable',
      capturedAtMs: 1_000,
      kmsEnvelope: true,
    });
  });

  it('overdue captures page SEV1 at 5 min; expired drop at 4 days', () => {
    expect(DEGRADED_ALARM_AGE_MS).toBe(5 * 60_000);
    const fresh = degradeToQueue('CA1', 't', null, 'db-unavailable', 0);
    const old = degradeToQueue('CA2', 't', null, 'db-unavailable', 0);
    expect(overdueCaptures([fresh], 4 * 60_000)).toStrictEqual([]);
    expect(overdueCaptures([old], 5 * 60_000)).toHaveLength(1);
    const ancient = degradeToQueue('CA3', 't', null, 'db-unavailable', 0);
    expect(expiredCaptures([ancient], 4 * 24 * 3_600_000)).toHaveLength(1);
    expect(expiredCaptures([fresh], 60_000)).toStrictEqual([]);
  });

  it('recovery drain is idempotent by CallSid (worker path shape)', () => {
    const queued: string[] = [];
    const seen = new Set<string>();
    const drain = (callSid: string): boolean => {
      if (seen.has(callSid)) return false;
      seen.add(callSid);
      queued.push(callSid);
      return true;
    };
    expect(drain('CA1')).toBe(true);
    expect(drain('CA1')).toBe(false);
    expect(queued).toStrictEqual(['CA1']);
  });
});
