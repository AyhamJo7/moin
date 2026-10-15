/**
 * Outbound webhooks (P29 TEN): subscribe-delivers + signature-valid.
 */
import { describe, expect, it } from 'vitest';
import { eventAllowed, retryDelayMs, signatureValid, signDelivery, subscribe } from './webhooks.ts';

describe('outbound webhooks', () => {
  it('subscribes HTTPS endpoints to allowlisted events', () => {
    expect(subscribe('https://crm.example.de/hook', 'lead.created')?.event).toBe('lead.created');
    expect(subscribe('http://crm.example.de/hook', 'lead.created')).toBe(null);
    expect(subscribe('https://crm.example.de/hook', 'nope')).toBe(null);
    expect(eventAllowed('task.completed')).toBe(true);
    expect(eventAllowed('user.deleted')).toBe(false);
  });

  it('signs and verifies deliveries with retry backoff', () => {
    const sig = signDelivery('s3cret', 'evt-1', 1_700_000_000, '{"a":1}');
    expect(signatureValid('s3cret', 'evt-1', 1_700_000_000, '{"a":1}', sig)).toBe(true);
    expect(signatureValid('s3cret', 'evt-1', 1_700_000_000, '{"a":2}', sig)).toBe(false);
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(1)).toBe(120_000);
  });
});
