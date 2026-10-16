/**
 * Self-service export (P16.03 LAUNCH): shaped + audited + rate-limited.
 */
import { describe, expect, it } from 'vitest';
import { exportAllowed, exportFormatValid, exportShaped } from './contact-export.ts';

describe('self-service contact export', () => {
  it('shapes the export to contact fields only', () => {
    const shaped = exportShaped(
      { displayName: 'A', phone: 'p', promptText: 'secret', modelId: 'm' },
      'csv',
    );
    expect(shaped['displayName']).toBe('A');
    expect(shaped['promptText']).toBeUndefined();
    expect(shaped['modelId']).toBeUndefined();
    expect(shaped['format']).toBe('csv');
    expect(exportFormatValid('json')).toBe(true);
    expect(exportFormatValid('xml')).toBe(false);
  });

  it('gates on audit + rate-limit + step-up', () => {
    expect(exportAllowed({ audited: true, withinRateLimit: true, stepUpDone: true })).toBe(true);
    expect(exportAllowed({ audited: false, withinRateLimit: true, stepUpDone: true })).toBe(false);
    expect(exportAllowed({ audited: true, withinRateLimit: false, stepUpDone: true })).toBe(false);
    expect(exportAllowed({ audited: true, withinRateLimit: true, stepUpDone: false })).toBe(false);
  });
});
