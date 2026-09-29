import { describe, expect, it } from 'vitest';
import { coverage, flows } from './check-dfd-coverage.ts';

describe('DFD coverage (P03.04.03)', () => {
  it('reads every flow out of the diagram', () => {
    const ids = flows().map((f) => f.id);
    expect(ids).toContain('F1');
    expect(ids).toContain('F12');
    expect(ids.length).toBeGreaterThanOrEqual(12);
  });

  it('the real diagram is fully covered', () => {
    const result = coverage();
    expect(result.withoutCategory).toStrictEqual([]);
    expect(result.withoutGuard).toStrictEqual([]);
    expect(result.unknownCategory).toStrictEqual([]);
  });

  // The check found all three of these in the diagram's first draft, which is the argument for
  // having it rather than reading the table.
  it('every flow names a guard at the boundary', () => {
    for (const flow of flows()) {
      expect(flow.guard.length, `${flow.id} has no guard`).toBeGreaterThan(0);
    }
  });

  it('every flow names at least one category', () => {
    for (const flow of flows()) {
      expect(flow.categories.length, `${flow.id} has no category`).toBeGreaterThan(0);
    }
  });
});
