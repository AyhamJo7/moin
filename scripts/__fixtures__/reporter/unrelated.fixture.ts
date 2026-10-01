/** A genuine matcher failure beside an unrelated one, in one module. */
import { expect } from 'vitest';
import { evidenceTest } from '../../mutation-evidence-test.ts';

evidenceTest('the intended test asserts', () => {
  expect(1).toBe(2);
});

evidenceTest('an unrelated test throws', () => {
  throw new Error('pool exhausted');
});
