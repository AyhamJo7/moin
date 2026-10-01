/**
 * Applying one variant to a source file (P06.10.07).
 *
 * `--validate` is an operator's courtesy, not a guarantee: a sweep run without it must enforce the
 * same rules. These tests cover the application function both paths use, because the gap between
 * them is exactly where a two-place anchor went unnoticed — `String.prototype.replace` rewrote the
 * first occurrence, so which guard that variant attacked was decided by file order.
 */
import { describe, expect, it } from 'vitest';
import { applyMutation } from './mutation-sweep.ts';

const SOURCE = ['const a = 1;', 'const b = 2;', 'const a = 1;', ''].join('\n');

describe('a unique anchor', () => {
  it('is spliced in exactly once, at its own position', () => {
    const applied = applyMutation(SOURCE, 'const b = 2;', 'const b = 99;');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.source).toBe(['const a = 1;', 'const b = 99;', 'const a = 1;', ''].join('\n'));
  });

  it('leaves the rest of the file byte for byte', () => {
    const applied = applyMutation(SOURCE, 'const b = 2;', '');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.source).toBe(['const a = 1;', '', 'const a = 1;', ''].join('\n'));
  });

  it('does not interpret the replacement', () => {
    // `String.prototype.replace` reads `$$` as an escape for `$` and `$&` as the match, which
    // silently corrupted every SQL function body (`AS $$ … $$` became `AS $ … $`) and made the
    // migration fail with a syntax error. The variant looked detected; nothing had been tested.
    const body = 'AS $$ BEGIN RETURN $1 + $& END $$';
    const applied = applyMutation(SOURCE, 'const b = 2;', body);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.source).toContain(body);
  });
});

describe('a missing anchor', () => {
  it('is refused rather than applied as a no-op', () => {
    const applied = applyMutation(SOURCE, 'const c = 3;', 'const c = 4;');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/not present/u);
  });

  it('refuses an empty anchor, which would otherwise match at position zero', () => {
    const applied = applyMutation(SOURCE, '', 'anything');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/does not identify a place/u);
  });
});

describe('a duplicate anchor', () => {
  it('is refused at application time, not only by --validate', () => {
    const applied = applyMutation(SOURCE, 'const a = 1;', 'const a = 2;');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/occurs 2 times/u);
    expect(applied.reason).toMatch(/arbitrary/u);
  });

  it('is refused however many times it occurs', () => {
    const applied = applyMutation('x x x x', 'x', 'y');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/occurs 4 times/u);
  });
});

describe('a replacement identical to the anchor', () => {
  it('is refused, because the mutant would be the pristine tree', () => {
    const applied = applyMutation(SOURCE, 'const b = 2;', 'const b = 2;');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/identical to the anchor/u);
  });

  it('is refused before the uniqueness check, so the reason is the useful one', () => {
    const applied = applyMutation(SOURCE, 'const a = 1;', 'const a = 1;');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/identical to the anchor/u);
  });
});
