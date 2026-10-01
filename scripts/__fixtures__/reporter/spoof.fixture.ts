/**
 * Every shape that has ever been mistaken for assertion evidence, run through real Vitest.
 *
 * These are deliberately failing tests. They are `*.fixture.ts` under their own config, so no main
 * suite collects them; `mutation-reporter.realvitest.test.ts` runs this file in a child Vitest with
 * the production probe and the production reporter, and asserts the verdicts.
 *
 * Nothing here may be classified `ASSERTION`.
 */
import { expect, it } from 'vitest';

/** The shape Codex threw to defeat the serializer-marker heuristic. */
function assertionShape(): Record<string, unknown> {
  return { name: 'AssertionError', expected: 1, actual: 2, showDiff: true, ok: false };
}

it('1 plain thrown assertion-shaped object', () => {
  // No matcher is invoked at all. A plain object literal, which Vitest serializes without the
  // `constructor`/`toString` keys that the previous heuristic treated as proof of foreignness.
  throw assertionShape();
});

it('2 error whose toJSON returns an assertion shape', () => {
  const error = new Error('infrastructure gave out');
  Object.assign(error, { toJSON: () => ({ ...assertionShape(), message: 'expected 1 to be 2' }) });
  throw error;
});

it('3 decorated error', () => {
  const error = new Error('database connection refused while executing toThrow assertion');
  Object.assign(error, { ...assertionShape(), operator: 'strictEqual', diff: 'fabricated' });
  throw error;
});

it('4 successful expect then plain throw', () => {
  // `expect` really was called and really succeeded, so `assertionCalls` is non-zero. That is why
  // the counter is diagnostic only: no matcher *failed*.
  expect(true).toBe(true);
  expect(1).toBe(1);
  throw assertionShape();
});

it('5 successful expects then a toJSON error', () => {
  expect(true).toBe(true);
  const error = new Error('still not an assertion');
  Object.assign(error, { toJSON: () => assertionShape() });
  throw error;
});

it('6 node assert.AssertionError', async () => {
  // A real AssertionError from a real assertion library — but not from a Vitest matcher, so it is
  // not on the approved evidence path and must not count.
  // Annotated because an assertion signature reached through a dynamic import needs a declared
  // type (TS2775); the point of the case is the error it throws, not how it is imported.
  const strictEqual: (a: unknown, b: unknown) => void = (await import('node:assert/strict'))
    .strictEqual;
  expect(true).toBe(true);
  strictEqual(1, 2);
});

it('7 genuine matcher failure', () => {
  expect(1).toBe(2);
});
