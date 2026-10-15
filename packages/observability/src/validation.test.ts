/**
 * Multi-customer validation (P32 SELL): matrix-complete + checklist-passes + signoff.
 */
import { describe, expect, it } from 'vitest';
import {
  checklistPasses,
  launchChecklist,
  launchReady,
  matrixComplete,
  signoffValid,
} from './validation.ts';

describe('multi-customer validation', () => {
  it('completes the matrix at 3 tenants × 30 days × 1 non-restaurant', () => {
    expect(
      matrixComplete({ payingTenants: 3, daysLive: 30, nonRestaurant: 1, sev1Unresolved: 0 }),
    ).toBe(true);
    expect(
      matrixComplete({ payingTenants: 2, daysLive: 30, nonRestaurant: 1, sev1Unresolved: 0 }),
    ).toBe(false);
    expect(
      matrixComplete({ payingTenants: 3, daysLive: 29, nonRestaurant: 1, sev1Unresolved: 0 }),
    ).toBe(false);
    expect(
      matrixComplete({ payingTenants: 3, daysLive: 30, nonRestaurant: 0, sev1Unresolved: 0 }),
    ).toBe(false);
    expect(
      matrixComplete({ payingTenants: 3, daysLive: 30, nonRestaurant: 1, sev1Unresolved: 1 }),
    ).toBe(false);
  });

  it('passes the checklist with every item evidenced', () => {
    expect(launchChecklist()).toHaveLength(5);
    const full = {
      entitlements: true,
      billing: true,
      support: true,
      onboarding: true,
      signoff: true,
    };
    expect(checklistPasses({ ...full })).toBe(true);
    expect(checklistPasses({ ...full, signoff: false })).toBe(false);
  });

  it('validates the go-live sign-off and wires it into the gate', () => {
    const full = {
      entitlements: true,
      billing: true,
      support: true,
      onboarding: true,
      signoff: true,
    };
    expect(signoffValid({ signer: 'founder', dateIso: '2027-01-15' })).toBe(true);
    expect(signoffValid({ signer: '  ', dateIso: '2027-01-15' })).toBe(false);
    expect(signoffValid({ signer: 'founder', dateIso: 'not-a-date' })).toBe(false);
    expect(launchReady({ ...full }, { signer: 'founder', dateIso: '2027-01-15' })).toBe(true);
    expect(launchReady({ ...full, signoff: false }, { signer: 'founder', dateIso: '2027-01-15' })).toBe(
      false,
    );
    expect(launchReady({ ...full }, { signer: '', dateIso: '2027-01-15' })).toBe(false);
  });
});
