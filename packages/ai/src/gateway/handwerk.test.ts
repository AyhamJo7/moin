/**
 * Handwerk template (P21 SELL): validates + binds.
 */
import { describe, expect, it } from 'vitest';
import { bindHandwerk, canonicalIntent, handwerkValid, HANDWERK_V1 } from './handwerk.ts';

describe('handwerk template', () => {
  it('validates through the loader with an eval set ref', () => {
    expect(handwerkValid()).toBe(true);
    expect(HANDWERK_V1.evalSetRef).toBe('handwerk-dev-v1');
    expect(canonicalIntent('quote_request')).toBe('lead');
    expect(canonicalIntent('emergency_urgent')).toBe('escalation');
    expect(canonicalIntent('nope')).toBe(null);
  });

  it('binds to a tenant with bounded overrides', () => {
    const bound = bindHandwerk({ disableIntents: ['quote_request'] });
    expect('error' in bound).toBe(false);
    if (!('error' in bound)) expect(bound.enabledIntents.has('quote_request')).toBe(false);
    expect('error' in bindHandwerk({ disableIntents: ['emergency_urgent'] })).toBe(true);
  });
});
