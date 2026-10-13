/**
 * Job envelope lint + queue topology (P08.01.01–.03). Pure unit tests, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  JOB_QUEUES,
  JOB_TYPES,
  checkVisibilityTimeout,
  lintEnvelope,
  queueFor,
} from './envelope.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '0193a5e2-9f4e-7a1b-8c2d-3e4f5a6b7c8d';
const CORR = '22222222-2222-4222-8222-222222222222';

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: JOB,
    type: 'sweep-run',
    version: 1,
    organisationId: ORG,
    correlationId: CORR,
    traceContext: null,
    attempt: 0,
    notBefore: null,
    payload: { taskId: ORG },
    ...over,
  };
}

describe('envelope', () => {
  it('accepts a valid envelope', () => {
    expect(lintEnvelope(valid()).ok).toBe(true);
  });

  it('rejects non-uuid ids, unknown types, bad version/attempt, content payload', () => {
    expect(lintEnvelope(valid({ jobId: 'nope' })).ok).toBe(false);
    expect(lintEnvelope(valid({ type: 'send-everything' })).ok).toBe(false);
    expect(lintEnvelope(valid({ version: 0 })).ok).toBe(false);
    expect(lintEnvelope(valid({ attempt: -1 })).ok).toBe(false);
    expect(lintEnvelope(valid({ correlationId: 'x' })).ok).toBe(false);
    expect(lintEnvelope(valid({ notBefore: 'tomorrow-ish' })).ok).toBe(false);
    // Content in the payload is refused: IDs only (P08 Security).
    expect(lintEnvelope(valid({ payload: { note: 'call back soon' } })).ok).toBe(false);
    expect(lintEnvelope(valid({ payload: ['id'] })).ok).toBe(false);
  });

  it('allows null org for pre-tenant system work', () => {
    expect(lintEnvelope(valid({ organisationId: null })).ok).toBe(true);
  });

  it('every job type has a queue; unknown types throw', () => {
    for (const type of JOB_TYPES) expect(typeof queueFor(type)).toBe('string');
    expect(Object.keys(JOB_QUEUES)).toHaveLength(JOB_TYPES.length);
    expect(() => queueFor('nope' as never)).toThrow(RangeError);
  });

  it('visibility floors reject short timeouts', () => {
    expect(() => checkVisibilityTimeout('sweeps', 30)).toThrow(RangeError);
    expect(() => checkVisibilityTimeout('nope', 360)).toThrow(RangeError);
    expect(() => checkVisibilityTimeout('sweeps', 360)).not.toThrow();
  });
});
