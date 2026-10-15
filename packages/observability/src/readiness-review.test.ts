/**
 * Readiness review (P17.12): aggregates + signoff-required.
 */
import { describe, expect, it } from 'vitest';
import { readinessComplete, readinessGates, type ReadinessGate } from './readiness-review.ts';

describe('production readiness review', () => {
  it('aggregates every P17 gate', () => {
    expect(readinessGates()).toEqual([
      'alarms',
      'dashboards',
      'backups',
      'rotation',
      'access',
      'waf',
      'scanning',
      'runbooks',
      'canary',
      'fallbacks',
      'killswitches',
    ]);
  });

  it('requires evidence on every gate plus sign-off', () => {
    const full = Object.fromEntries(readinessGates().map((gate) => [gate, true])) as Record<
      ReadinessGate,
      boolean
    >;
    expect(readinessComplete({ evidence: full, signedOff: true })).toBe(true);
    expect(readinessComplete({ evidence: full, signedOff: false })).toBe(false);
    expect(readinessComplete({ evidence: { ...full, waf: false }, signedOff: true })).toBe(false);
  });
});
