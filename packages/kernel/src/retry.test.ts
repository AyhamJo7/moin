/**
 * Worker retry arithmetic (P08.05.02–.03). Pure unit tests, jitter pinned.
 */
import { describe, expect, it } from 'vitest';
import { JobFailure, backoffSeconds, classifyFailure, decideRetry, isPoison } from './retry.ts';

describe('retry', () => {
  it('backs off exponentially with bounded jitter', () => {
    // Pinned random: u=0 → −20 %, u=1 → +20 %.
    expect(backoffSeconds(0, () => 0)).toBe(24);
    expect(backoffSeconds(0, () => 1)).toBe(36);
    expect(backoffSeconds(1, () => 0.5)).toBe(120);
    expect(backoffSeconds(99, () => 0.5)).toBe(1800);
  });

  it('retries until max attempts, then DLQ', () => {
    expect(decideRetry('sweep-run', 0, () => 0.5).toDlq).toBe(false);
    expect(decideRetry('sweep-run', 1, () => 0.5).toDlq).toBe(false);
    const last = decideRetry('sweep-run', 2, () => 0.5);
    expect(last.toDlq).toBe(true);
    expect(last.delaySeconds).toBe(0);
    // Unknown types get the default budget of 3.
    expect(decideRetry('nope', 2, () => 0.5).toDlq).toBe(true);
  });

  it('RangeErrors are poison, everything else transient', () => {
    expect(isPoison(new RangeError('schema'))).toBe(true);
    expect(isPoison(new Error('db down'))).toBe(false);
    expect(isPoison('string')).toBe(false);
  });
});

describe('classifyFailure (P08.05.02/.03)', () => {
  it('keeps a safe JobFailure code and its retry class', () => {
    expect(classifyFailure(new JobFailure('provider-timeout'))).toEqual({
      code: 'provider-timeout',
      permanent: false,
    });
    expect(classifyFailure(new JobFailure('unsupported-shape', true))).toEqual({
      code: 'unsupported-shape',
      permanent: true,
    });
  });

  it('never lets an arbitrary error message reach the code', () => {
    const secret = 'caller +4930123456 said hello';
    expect(classifyFailure(new Error(secret))).toEqual({ code: 'handler-error', permanent: false });
    expect(classifyFailure(new JobFailure(secret))).toEqual({
      code: 'handler-error',
      permanent: false,
    });
    expect(JSON.stringify(classifyFailure('plain string'))).not.toContain('plain');
  });

  it('treats a RangeError as a permanent schema failure', () => {
    expect(classifyFailure(new RangeError('bad payload'))).toEqual({
      code: 'payload-invalid',
      permanent: true,
    });
  });
});
