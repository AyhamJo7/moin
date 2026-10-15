/**
 * Hardening sweep (P30 SELL): audit-triage shapes.
 */
import { describe, expect, it } from 'vitest';
import { auditTriaged, findingValid } from './hardening-sweep.ts';

describe('security hardening sweep', () => {
  it('validates finding records', () => {
    expect(
      findingValid({ id: 'PT-001', severity: 'high', state: 'open', title: 'XSS in notes' }),
    ).toBe(true);
    expect(findingValid({ id: '', severity: 'low', state: 'open', title: 'x' })).toBe(false);
    expect(findingValid({ id: 'PT-1', severity: 'low', state: 'open', title: '  ' })).toBe(false);
  });

  it('triages: open critical/high block, rest passes', () => {
    expect(auditTriaged([])).toBe(true);
    expect(auditTriaged([{ id: 'PT-1', severity: 'critical', state: 'open', title: 'RCE' }])).toBe(
      false,
    );
    expect(
      auditTriaged([{ id: 'PT-1', severity: 'critical', state: 'triaged', title: 'RCE' }]),
    ).toBe(true);
    expect(auditTriaged([{ id: 'PT-2', severity: 'medium', state: 'open', title: 'Info' }])).toBe(
      true,
    );
  });
});
