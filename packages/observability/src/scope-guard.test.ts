/**
 * Scope guardrails (P16.13): in-scope passes, out-of-scope refuses.
 */
import { describe, expect, it } from 'vitest';
import { businessInScope, intentDenied, scopePasses, SCOPE_REFUSAL } from './scope-guard.ts';

describe('scope guardrails', () => {
  it('passes in-scope business with allowed intent', () => {
    expect(scopePasses('restaurant', 'table-booking')).toBe(true);
    expect(businessInScope('handwerk')).toBe(true);
    expect(businessInScope('bank')).toBe(false);
  });

  it('refuses denylisted intents with a German message', () => {
    expect(intentDenied('employment-decision')).toBe(true);
    expect(intentDenied('credit-decision')).toBe(true);
    expect(intentDenied('biometrics')).toBe(true);
    expect(intentDenied('table-booking')).toBe(false);
    expect(scopePasses('restaurant', 'employment-decision')).toBe(false);
    expect(SCOPE_REFUSAL.length).toBeGreaterThan(0);
  });
});
