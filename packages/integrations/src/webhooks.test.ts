/**
 * Outbound webhooks (P29 TEN): subscribe-delivers + signature-valid + tenant-scoped.
 */
import { describe, expect, it } from 'vitest';
import {
  deliveryAllowed,
  eventAllowed,
  retryDelayMs,
  signatureValid,
  signDelivery,
  subscribe,
} from './webhooks.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('outbound webhooks', () => {
  it('subscribes tenant-scoped HTTPS endpoints to allowlisted events', () => {
    const sub = subscribe(ORG_A, 'https://crm.example.de/hook', 'lead.created');
    expect(sub?.event).toBe('lead.created');
    expect(sub?.organisationId).toBe(ORG_A);
    expect(subscribe('nope', 'https://crm.example.de/hook', 'lead.created')).toBe(null);
    expect(subscribe(ORG_A, 'http://crm.example.de/hook', 'lead.created')).toBe(null);
    expect(subscribe(ORG_A, 'https://crm.example.de/hook', 'nope')).toBe(null);
    expect(eventAllowed('task.completed')).toBe(true);
    expect(eventAllowed('user.deleted')).toBe(false);
  });

  it('refuses cross-tenant delivery', () => {
    const sub = subscribe(ORG_A, 'https://crm.example.de/hook', 'lead.created');
    expect(sub).not.toBe(null);
    if (sub === null) throw new Error('unreachable');
    expect(deliveryAllowed(sub, ORG_A)).toBe(true);
    expect(deliveryAllowed(sub, ORG_B)).toBe(false);
  });

  it('signs and verifies deliveries with retry backoff', () => {
    const sig = signDelivery('s3cret', 'evt-1', 1_700_000_000, '{"a":1}');
    expect(signatureValid('s3cret', 'evt-1', 1_700_000_000, '{"a":1}', sig)).toBe(true);
    expect(signatureValid('s3cret', 'evt-1', 1_700_000_000, '{"a":2}', sig)).toBe(false);
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(1)).toBe(120_000);
  });
});
