/**
 * Subprocessor register (P16.08): complete + region-enforced.
 */
import { describe, expect, it } from 'vitest';
import { registerDpaComplete, registerEntryValid, regionAllowed } from './subprocessors.ts';

const AWS = {
  name: 'aws',
  purpose: 'hosting',
  region: 'eu-central-1',
  transferMechanism: 'none-intra-eu',
  dpa: 'signed',
} as const;

describe('subprocessor register', () => {
  it('enforces the EU region allowlist', () => {
    expect(regionAllowed('eu-central-1')).toBe(true);
    expect(regionAllowed('us-east-1')).toBe(false);
    expect(registerEntryValid({ ...AWS })).toBe(true);
    expect(registerEntryValid({ ...AWS, region: 'us-east-1' })).toBe(false);
    expect(registerEntryValid({ ...AWS, name: '  ' })).toBe(false);
  });

  it('completes only when every DPA is signed (EXT-27)', () => {
    expect(registerDpaComplete([{ ...AWS }])).toBe(true);
    expect(registerDpaComplete([{ ...AWS, dpa: 'pending' }])).toBe(false);
    expect(registerDpaComplete([])).toBe(false);
  });
});
