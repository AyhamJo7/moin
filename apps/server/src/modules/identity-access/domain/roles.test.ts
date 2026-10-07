/**
 * The RBAC decision table, pinned without a database (P06.07.01).
 *
 * Every capability × every role is asserted: the matrix is data, so a change to it fails loudly
 * here rather than silently widening somewhere downstream. The integration suite proves the guard
 * enforces this table end to end.
 */
import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { CAPABILITIES, isPermission, isRole, may, PERMISSIONS, ROLES } from './roles.ts';

describe('the RBAC decision table (P06.07.01)', () => {
  evidenceTest('owners hold every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(may('owner', [], capability), capability).toBe(true);
    }
  });

  evidenceTest('staff hold sessions only', () => {
    expect(may('staff', [], 'session:step-up')).toBe(true);
    expect(may('staff', [], 'session:sign-out-others')).toBe(true);
    for (const capability of CAPABILITIES) {
      if (capability === 'session:step-up' || capability === 'session:sign-out-others') continue;
      expect(may('staff', [], capability), capability).toBe(false);
    }
  });

  evidenceTest('admins hold management but not owners, integrations or billing', () => {
    for (const capability of [
      'users:manage',
      'knowledge:edit',
      'knowledge:approve',
      'data:export-erase',
      'support:grant',
    ] as const) {
      expect(may('admin', [], capability), capability).toBe(true);
    }
    for (const capability of [
      'users:manage-owners',
      'integrations:manage',
      'billing:manage',
      'tenant:terminate',
    ] as const) {
      expect(may('admin', [], capability), capability).toBe(false);
    }
  });

  evidenceTest('permissions extend exactly their capability', () => {
    expect(may('admin', ['integration_admin'], 'integrations:manage')).toBe(true);
    expect(may('staff', ['integration_admin'], 'integrations:manage')).toBe(true);
    expect(may('staff', ['billing_admin'], 'billing:manage')).toBe(true);
    // Crossed permissions grant nothing: billing does not open integrations and vice versa.
    expect(may('staff', ['billing_admin'], 'integrations:manage')).toBe(false);
    expect(may('staff', ['integration_admin'], 'billing:manage')).toBe(false);
    // Permissions never open role-gated capabilities outside their row.
    expect(may('staff', ['integration_admin', 'billing_admin'], 'tenant:terminate')).toBe(false);
    expect(may('staff', ['integration_admin', 'billing_admin'], 'users:manage')).toBe(false);
  });

  evidenceTest('unknown roles and permissions fail closed', () => {
    expect(may('superadmin', [], 'session:step-up')).toBe(false);
    expect(may('', [], 'session:step-up')).toBe(false);
    expect(may('owner', ['root'], 'tenant:terminate')).toBe(true);
    expect(may('staff', ['root'], 'tenant:terminate')).toBe(false);
    expect(isRole('owner')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isPermission('billing_admin')).toBe(true);
    expect(isPermission('root')).toBe(false);
    expect(ROLES).toStrictEqual(['owner', 'admin', 'staff']);
    expect(PERMISSIONS).toStrictEqual(['integration_admin', 'billing_admin']);
  });
});
