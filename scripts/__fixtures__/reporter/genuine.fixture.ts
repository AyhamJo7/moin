/** The ordinary shapes: a passing test, a timeout, and a namesake of another file's test. */
import { describe, expect, it } from 'vitest';
import { evidenceTest } from '../../mutation-evidence-test.ts';

describe('reporter fixture', () => {
  evidenceTest('genuine assertion failure', () => {
    expect(1).toBe(2);
  });

  evidenceTest('ordinary thrown error', () => {
    throw new Error('boom');
  });

  it('passes', () => {
    expect(1).toBe(1);
  });

  evidenceTest(
    'times out',
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    },
    250,
  );
});

describe('shared name', () => {
  it('appears in two files', () => {
    expect(1).toBe(1);
  });
});
