/** The same exact full name as in `genuine.fixture.ts`, to prove file identity disambiguates. */
import { describe, expect, it } from 'vitest';

describe('shared name', () => {
  it('appears in two files', () => {
    expect(1).toBe(2);
  });
});
