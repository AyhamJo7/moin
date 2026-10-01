/**
 * Every way a test could try to produce a matcher failure it did not have (P06.10.07).
 *
 * All of these are deliberately failing tests, registered through the **production** trusted
 * wrapper, so each one's terminal value really is compared against the private map of objects
 * Vitest matchers threw. `mutation-reporter.realvitest.test.ts` runs this file in a child Vitest
 * and asserts the verdicts.
 *
 * Only cases 5 and 6 may be evidence.
 */
import { expect } from 'vitest';
import { evidenceTest } from '../../mutation-evidence-test.ts';

/** A genuine matcher failure, caught so the test can try to launder it. */
function caughtMatcherFailure(): unknown {
  try {
    expect(1).toBe(2);
  } catch (error) {
    return error;
  }
  throw new Error('unreachable: the matcher was supposed to fail');
}

evidenceTest('1 token-copy equivalent: Object.assign onto an ordinary Error', () => {
  const caught = caughtMatcherFailure();
  const terminal = new Error('ordinary');
  // This is the attack that broke the previous design, when provenance was a field.
  Object.assign(terminal, caught);
  throw terminal;
});

evidenceTest('2 every own property and symbol copied onto another Error', () => {
  const caught = caughtMatcherFailure() as object;
  const terminal = new Error('ordinary');
  for (const key of Object.getOwnPropertyNames(caught)) {
    const descriptor = Object.getOwnPropertyDescriptor(caught, key);
    if (descriptor !== undefined) Object.defineProperty(terminal, key, descriptor);
  }
  for (const key of Object.getOwnPropertySymbols(caught)) {
    const descriptor = Object.getOwnPropertyDescriptor(caught, key);
    if (descriptor !== undefined) Object.defineProperty(terminal, key, descriptor);
  }
  throw terminal;
});

evidenceTest('3 a clone with the same prototype, name, message and stack', () => {
  const caught = caughtMatcherFailure() as Error;
  const clone: object = Object.create(Object.getPrototypeOf(caught) as object);
  Object.assign(clone, caught, {
    name: caught.name,
    message: caught.message,
    stack: caught.stack,
  });
  throw clone;
});

evidenceTest('4 async transfer: await, then throw a copy', async () => {
  const caught = caughtMatcherFailure();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const terminal = new Error('ordinary');
  Object.assign(terminal, caught);
  throw terminal;
});

evidenceTest('5 the same matcher object rethrown immediately', () => {
  try {
    expect(1).toBe(2);
  } catch (error) {
    // Identity is preserved, so this is the one shape that counts.
    throw error;
  }
});

evidenceTest('6 the same matcher object thrown later in the same invocation', () => {
  const caught = caughtMatcherFailure();
  // Harmless work in between. Intended semantics: still eligible, because exactly one matcher
  // failure exists in this invocation and the terminal value is that object.
  const sum = [1, 2, 3].reduce((total, value) => total + value, 0);
  if (sum !== 6) throw new Error('unreachable');
  throw caught;
});

evidenceTest('7 a swallowed matcher failure, then an ordinary error', () => {
  caughtMatcherFailure();
  throw new Error('something else entirely');
});

evidenceTest('11 two matcher failures in one invocation', () => {
  caughtMatcherFailure();
  expect(3).toBe(4);
});

evidenceTest('13 plain thrown assertion-shaped object', () => {
  throw { name: 'AssertionError', expected: 1, actual: 2, showDiff: true, ok: false };
});

evidenceTest('14 an Error whose toJSON returns an assertion shape', () => {
  const terminal = new Error('infrastructure gave out');
  Object.assign(terminal, {
    toJSON: () => ({
      name: 'AssertionError',
      message: 'expected 1 to be 2',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    }),
  });
  throw terminal;
});

evidenceTest('15 a successful expect, then a plain throw', () => {
  expect(true).toBe(true);
  expect(1).toBe(1);
  throw { name: 'AssertionError', expected: 1, actual: 2, showDiff: true, ok: false };
});

evidenceTest("16 Node's own assert.AssertionError", async () => {
  const strictEqual: (a: unknown, b: unknown) => void = (await import('node:assert/strict'))
    .strictEqual;
  expect(true).toBe(true);
  strictEqual(1, 2);
});

evidenceTest('17 a forged probe record planted in task.meta', (context) => {
  // The probe writes its own record in `afterEach`, which runs after this body, so a planted one is
  // overwritten. Nothing is hidden; the earned record simply wins.
  const { task } = context as unknown as { task: { meta: Record<string, unknown> } };
  task.meta['moinAssertionProbe'] = {
    version: 3,
    event: 'MATCHER_IDENTITY_CONFIRMED',
    reason: 'forged',
    invocationId: 'forged',
    testFile: 'scripts/__fixtures__/reporter/identity.fixture.ts',
    testFullName: '17 a forged probe record planted in task.meta',
    evidenceEligible: true,
    matcherFailures: 1,
    matchers: ['toBe'],
    expectCalls: 1,
    rejected: 0,
    suspect: [],
  };
  throw new Error('not an assertion');
});
