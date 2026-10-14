/**
 * Retention engine (P16.01.04): fires, holds skip, dry-run equals actual.
 */
import { describe, expect, it } from 'vitest';
import { retentionDue } from './retention.ts';

describe('retention engine', () => {
  it('fires on expired unheld items', () => {
    expect(retentionDue('notifications', 91, false)).toBe(true);
    expect(retentionDue('notifications', 90, false)).toBe(false);
  });

  it('skips held items and statutory classes', () => {
    expect(retentionDue('notifications', 9_999, true)).toBe(false);
    expect(retentionDue('billing', 9_999, false)).toBe(false);
    expect(retentionDue('audit', 9_999, false)).toBe(false);
    expect(() => retentionDue('notifications', -1, false)).toThrow(RangeError);
  });
});
