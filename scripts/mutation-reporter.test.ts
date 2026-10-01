/**
 * The reporter's error typing, checked against measured shapes (P06.10.07).
 *
 * The classifier's fixtures assume this mapping, so testing the classifier alone would only prove
 * it agrees with an assumption. Every shape below was read off a real Vitest 5 run — the key sets
 * are copied from what the reporter actually saw, not invented.
 */
import { describe, expect, it } from 'vitest';
import { typedError } from './mutation-reporter.ts';

/** `expect(1).toBe(2)` — and the same keys appear for every matcher that was checked. */
const ASSERTION_KEYS = {
  message: 'expected 1 to be 2 // Object.is equality',
  actual: '1',
  expected: '2',
  showDiff: true,
  operator: 'strictEqual',
  diff: '- Expected\n+ Received',
  name: 'AssertionError',
  ok: false,
  stack: 'AssertionError: expected 1 to be 2\n    at ...',
  stacks: [],
};

/** `throw new Error(...)` — measured keys, with no assertion metadata whatever the message says. */
const THROWN_KEYS = {
  stack: 'Error: boom\n    at ...',
  message: 'connection refused while executing toThrow assertion',
  constructor: 'Function<Error>',
  name: 'Error',
  toString: 'Function<toString>',
  stacks: [],
};

describe('an assertion error', () => {
  it('is identified by its name together with its metadata', () => {
    const typed = typedError(ASSERTION_KEYS);
    expect(typed.name).toBe('AssertionError');
    expect(typed.isAssertion).toBe(true);
    expect([...typed.assertionFields].sort()).toStrictEqual([
      'actual',
      'expected',
      'ok',
      'showDiff',
    ]);
  });

  it('is identified the same way for matchers that omit `operator`', () => {
    // Measured: `toMatchObject` and `rejects.toThrow` carry no `operator`, so requiring it would
    // have silently downgraded two real matcher families to non-evidence.
    const withoutOperator = Object.fromEntries(
      Object.entries(ASSERTION_KEYS).filter(([key]) => key !== 'operator'),
    );
    expect(typedError(withoutOperator).isAssertion).toBe(true);
  });
});

describe('anything else', () => {
  it('is not an assertion, whatever its message contains', () => {
    const typed = typedError(THROWN_KEYS);
    expect(typed.name).toBe('Error');
    expect(typed.isAssertion).toBe(false);
    expect(typed.assertionFields).toStrictEqual([]);
    // The message is carried for display, and carries matcher words — which is precisely why it
    // must not be what decides.
    expect(typed.message).toMatch(/toThrow/u);
  });

  it('is not an assertion when the name is right but the metadata is absent', () => {
    expect(typedError({ ...THROWN_KEYS, name: 'AssertionError' }).isAssertion).toBe(false);
  });

  it('is not an assertion when the metadata is present but the name is wrong', () => {
    expect(typedError({ ...ASSERTION_KEYS, name: 'Error' }).isAssertion).toBe(false);
  });

  it('needs every assertion field, not some of them', () => {
    for (const field of ['expected', 'actual', 'showDiff', 'ok'] as const) {
      // Rebuilt without the field rather than deleted, so the object never has a computed key
      // removed — and so the omission is visible in the test rather than implied.
      const partial = Object.fromEntries(
        Object.entries(ASSERTION_KEYS).filter(([key]) => key !== field),
      );
      expect(typedError(partial).isAssertion).toBe(false);
    }
  });

  it('survives a non-object, and reports it as unknown rather than throwing', () => {
    for (const value of [undefined, null, 'a string', 42]) {
      const typed = typedError(value);
      expect(typed.isAssertion).toBe(false);
      expect(typed.name).toBe('unknown');
    }
  });
});

describe('the message', () => {
  it('is one line with escape sequences removed', () => {
    const typed = typedError({
      ...THROWN_KEYS,
      message: '\u001B[31mTransform failed\u001B[0m\nwith 1 error\nand more detail',
    });
    expect(typed.message).toBe('Transform failed');
    // eslint-disable-next-line no-control-regex -- asserting the absence of escape sequences.
    expect(typed.message).not.toMatch(/\u001B\[/u);
  });
});
