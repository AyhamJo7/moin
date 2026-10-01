/** Real shapes for the reporter's integration test. Never collected by the main suites. */
import { describe, expect, it } from 'vitest';

describe('reporter fixture', () => {
  it('genuine assertion failure', () => {
    expect(1).toBe(2);
  });

  it('spoofed assertion object', () => {
    // The exploit: an ordinary Error decorated to look exactly like an assertion.
    const error = new Error('database connection refused while executing toThrow assertion');
    Object.assign(error, {
      name: 'AssertionError',
      expected: 'a',
      actual: 'b',
      showDiff: true,
      ok: false,
      operator: 'strictEqual',
      diff: 'fabricated',
    });
    throw error;
  });

  it('passing expects then a decorated throw', () => {
    // `expect` really was called here, so the in-process counter alone would be satisfied.
    expect(1).toBe(1);
    expect(2).toBe(2);
    const error = new Error('infrastructure gave out');
    Object.assign(error, {
      name: 'AssertionError',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    });
    throw error;
  });

  it('ordinary thrown error', () => {
    throw new Error('boom');
  });

  it('passes', () => {
    expect(1).toBe(1);
  });

  it('times out', async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }, 250);
});

describe('shared name', () => {
  it('appears in two files', () => {
    expect(1).toBe(1);
  });
});
