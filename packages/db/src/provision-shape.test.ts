/**
 * Tenant provisioning (P18.03): works + idempotent-retry.
 */
import { describe, expect, it } from 'vitest';
import { pilotEntitlements, provisionKey, provisionValid } from './provision-shape.ts';

describe('tenant provisioning shape', () => {
  it('provisions from a well-formed template request', () => {
    expect(provisionValid({ template: 'restaurant@1.x', plan: 'pilot', earlyAccess: false })).toBe(
      true,
    );
    expect(provisionValid({ template: 'nope', plan: 'pilot', earlyAccess: false })).toBe(false);
    expect(
      provisionValid({ template: 'restaurant@1.x', plan: 'enterprise', earlyAccess: false }),
    ).toBe(false);
  });

  it('retries idempotently with pilot entitlements', () => {
    const request = { template: 'restaurant@1.x', plan: 'pilot', earlyAccess: false } as const;
    expect(provisionKey({ ...request })).toBe(provisionKey({ ...request }));
    expect(provisionKey({ ...request })).toBe('provision:restaurant@1.x:pilot:noea');
    expect(pilotEntitlements()).toEqual({ minutesCap: 300, hardCapOn: true, smsCap: 100 });
  });
});
