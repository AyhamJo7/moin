/**
 * A test that swallows a real matcher failure and then fails some other way.
 *
 * The matcher genuinely failed, so the trusted event exists — but the failure that propagated is
 * not that one, and a second swallowed matcher failure makes "which assertion failed" unanswerable.
 * Both must fail closed rather than count.
 */
import { expect, it } from 'vitest';

it('swallows one matcher failure then throws', () => {
  try {
    expect(1).toBe(2);
  } catch {
    // deliberately ignored
  }
  throw new Error('something else entirely');
});

it('fails two matchers in one test', () => {
  try {
    expect(1).toBe(2);
  } catch {
    // deliberately ignored
  }
  expect(3).toBe(4);
});

it('swallows a matcher failure and passes', () => {
  try {
    expect(1).toBe(2);
  } catch {
    // deliberately ignored
  }
  expect(true).toBe(true);
});
