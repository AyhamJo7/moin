/**
 * PII log scanner (P15.01.02/.04): fails on a seeded PII log line.
 */
import { describe, expect, it } from 'vitest';
import { lineHasPii, scanLines } from './pii-scan.ts';

describe('pii log scanner', () => {
  it('fails on a seeded PII log line', () => {
    expect(lineHasPii('call finished requestId=req_1 durationMs=1200')).toBe(false);
    expect(lineHasPii('no contact for +4915112345678')).toBe(true);
    expect(lineHasPii('notify anna.schmidt@example.de about the task')).toBe(true);
  });

  it('reports the offending line indexes', () => {
    expect(scanLines(['ok line', 'call +4915112345678', 'ok too'])).toEqual([1]);
    expect(scanLines(['clean', 'cleaner'])).toEqual([]);
  });
});
