/**
 * Service authorisation, without a database (P06.07.02).
 *
 * `requireCapability` throws the named capability for insufficient roles and passes holders.
 */
import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { ForbiddenError, requireCapability } from './authorization.ts';

describe('service authorisation (P06.07.02)', () => {
  evidenceTest('requireCapability passes holders and throws the capability for others', () => {
    expect(() => {
      requireCapability('owner', [], 'tenant:terminate');
    }).not.toThrow();
    expect(() => {
      requireCapability('admin', ['billing_admin'], 'billing:manage');
    }).not.toThrow();
    try {
      requireCapability('staff', [], 'tenant:terminate');
      expect.unreachable('staff must not terminate tenants');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).capability).toBe('tenant:terminate');
    }
    try {
      requireCapability('admin', [], 'billing:manage');
      expect.unreachable('admin without the permission must not bill');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
    }
  });
});
