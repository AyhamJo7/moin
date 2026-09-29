// NEGATIVE CONTROL for P02.06.07 — never merged.
//
// Proves that the `unit tests` job fails the build when a test fails, rather than reporting the
// suite green because a non-zero exit was swallowed somewhere between vitest and the runner.
import { describe, expect, it } from 'vitest';

describe('negative control', () => {
  it('fails on purpose, to prove the unit job is load-bearing', () => {
    expect(1 + 1).toBe(3);
  });
});
