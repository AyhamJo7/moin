/**
 * Passage validation boundaries (P09.09.04 SELL): pure input gates. The
 * integration test proves the rows; this test is the mutation target.
 */
import { describe, expect, it } from 'vitest';
import { PassageValidators } from './passages.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

describe('passage validation', () => {
  it('gates version ids and model versions', () => {
    expect(UUID_RE.test('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(UUID_RE.test('nope')).toBe(false);
    expect(PassageValidators.checkVersion('m1')).toBe('m1');
    expect(() => PassageValidators.checkVersion('  ')).toThrow(RangeError);
    expect(() => PassageValidators.checkVersion('x'.repeat(81))).toThrow(RangeError);
  });
});
