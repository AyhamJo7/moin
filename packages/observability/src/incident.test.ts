/**
 * Incident management (P15.10): severity-shapes + log-records.
 */
import { describe, expect, it } from 'vitest';
import { breachPackComplete, logIsValid } from './incident.ts';

const LOG = {
  id: '11111111-1111-4111-8111-111111111111',
  severity: 'SEV1',
  title: 'Cross-tenant exposure drill',
  openedAtMs: 1_000,
  closedAtMs: null,
} as const;

describe('incident management', () => {
  it('shapes severities and validates log records', () => {
    expect(logIsValid({ ...LOG })).toBe(true);
    expect(logIsValid({ ...LOG, id: 'nope' })).toBe(false);
    expect(logIsValid({ ...LOG, title: '  ' })).toBe(false);
    expect(logIsValid({ ...LOG, closedAtMs: 500 })).toBe(false);
    expect(logIsValid({ ...LOG, closedAtMs: 2_000 })).toBe(true);
  });

  it('completes the Art. 33(3) breach pack', () => {
    const pack = {
      nature: 'exposure',
      categories: ['contact'],
      approximateSubjects: 3,
      consequences: 'read by wrong tenant',
      measures: 'revoked, rotated',
      dpoContact: 'dpo@example.de',
    } as const;
    expect(breachPackComplete({ ...pack })).toBe(true);
    expect(breachPackComplete({ ...pack, categories: [] })).toBe(false);
    expect(breachPackComplete({ ...pack, dpoContact: '' })).toBe(false);
  });
});
