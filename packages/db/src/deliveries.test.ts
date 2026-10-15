/**
 * Delivery tracking (P14.07.03): receipt-recorded, retry-bounded, no dup.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, nextAttempt, retryDelayMs } from './deliveries.ts';

describe('delivery tracking', () => {
  it('bounds retries with backoff; past the bound goes DLQ', () => {
    expect(nextAttempt('failed', 0)).toBe('pending');
    expect(nextAttempt('failed', MAX_ATTEMPTS)).toBe('dlq');
    expect(nextAttempt('sent', 0)).toBe('sent');
    expect(nextAttempt('dlq', 0)).toBe('dlq');
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
  });
});
