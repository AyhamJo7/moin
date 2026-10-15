/**
 * Contact rectification (P16.04): updates validate, audit records.
 */
import { describe, expect, it } from 'vitest';
import { rectifyAuditNote, rectifySummaryNote, rectifyValid } from './rectify.ts';

describe('contact rectification', () => {
  it('validates updates with a real change', () => {
    expect(
      rectifyValid({
        field: 'displayName',
        oldValue: 'A',
        newValue: 'B',
        regenerateSummary: false,
      }),
    ).toBe(true);
    expect(
      rectifyValid({
        field: 'displayName',
        oldValue: 'A',
        newValue: 'A',
        regenerateSummary: false,
      }),
    ).toBe(false);
    expect(
      rectifyValid({
        field: 'displayName',
        oldValue: 'A',
        newValue: '  ',
        regenerateSummary: false,
      }),
    ).toBe(false);
  });

  it('records the audit note and summary marker', () => {
    const request = {
      field: 'phone',
      oldValue: 'x',
      newValue: 'y',
      regenerateSummary: false,
    } as const;
    expect(rectifyAuditNote({ ...request })).toBe('rectified phone (manuell korrigiert)');
    expect(rectifySummaryNote({ ...request })).toContain('manuell korrigiert');
    expect(rectifySummaryNote({ ...request, regenerateSummary: true })).toContain('neu erstellt');
  });
});
