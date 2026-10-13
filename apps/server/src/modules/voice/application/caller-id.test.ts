/**
 * Caller-ID classification (P11.11.04, FS-26): all four classes, the
 * forwarded-call fixture (`From` equals the tenant's own number), identity
 * gating, and the collect-vs-offer rule.
 */
import { describe, expect, it } from 'vitest';
import {
  CALLBACK_OFFER,
  classifyCallerId,
  mustCollectCallback,
  usableForIdentity,
} from './caller-id.ts';

const OWN = new Set(['+494012345678']);

describe('caller-id handling', () => {
  it('classifies all four classes', () => {
    expect(classifyCallerId('+4917612345678', OWN)).toBe('present');
    expect(classifyCallerId('anonymous', OWN)).toBe('withheld');
    expect(classifyCallerId('WITHHELD', OWN)).toBe('withheld');
    expect(classifyCallerId('', OWN)).toBe('withheld');
    expect(classifyCallerId('+494012345678', OWN)).toBe('tenant-owned');
    expect(classifyCallerId('+499001234567', OWN)).toBe('suspicious');
    expect(classifyCallerId('0049301234', OWN)).toBe('suspicious');
  });

  it('forwarded calls present the tenant number — never identity (FS-26)', () => {
    const cls = classifyCallerId('+494012345678', OWN);
    expect(cls).toBe('tenant-owned');
    expect(usableForIdentity(cls)).toBe(false);
    expect(mustCollectCallback(cls)).toBe(true);
  });

  it('only present numbers resolve identity; the rest always collect', () => {
    expect(usableForIdentity('present')).toBe(true);
    expect(usableForIdentity('suspicious')).toBe(false);
    expect(usableForIdentity('withheld')).toBe(false);
    expect(mustCollectCallback('present')).toBe(false);
    expect(mustCollectCallback('withheld')).toBe(true);
    expect(mustCollectCallback('suspicious')).toBe(true);
    expect(CALLBACK_OFFER).toContain('zurückrufen');
  });
});
