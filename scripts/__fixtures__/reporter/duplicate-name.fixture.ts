/** The same exact full name as in `genuine.fixture.ts`, to prove file identity disambiguates. */
import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';

describe('shared name', () => {
  evidenceTest('appears in two files', () => {
    expect(1).toBe(2);
  });
});
