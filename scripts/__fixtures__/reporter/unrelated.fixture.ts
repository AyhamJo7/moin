/** A genuine matcher failure beside an unrelated one, in one module. */
import { expect, it } from 'vitest';

it('the intended test asserts', () => {
  expect(1).toBe(2);
});

it('an unrelated test throws', () => {
  throw new Error('pool exhausted');
});
