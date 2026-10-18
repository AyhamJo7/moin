/**
 * Premise of the fixed-auth-token run: the token it forces really yields a signature that starts
 * with `A` for the signature tests' URL and parameters. If this stops holding, that run no longer
 * discriminates, so it fails loudly. Skipped in the ordinary unit run, where the token is random.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSignature, isValidSignature } from '../src/signature/validate.ts';

const url = 'https://voice.example.de/voice/status?x=1';
const params = { CallSid: 'CA9', CallStatus: 'completed' };

describe.runIf(process.env['FIXED_AUTH_TOKEN_RUN'] === '1')('the fixed auth token', () => {
  it('is the same every time and its genuine signature starts with A', () => {
    const token = randomBytes(16).toString('hex');
    expect(token).toBe('49'.repeat(16));
    const signature = computeSignature(token, url, params);
    expect(signature.startsWith('A')).toBe(true);
    // A real signature, accepted by the real verifier; the old fixed-`A` replacement leaves it intact.
    expect(isValidSignature({ authToken: token, url, signature, params })).toBe(true);
    expect(`A${signature.slice(1)}`).toBe(signature);
  });
});
