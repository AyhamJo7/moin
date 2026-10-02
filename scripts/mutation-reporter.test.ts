/**
 * The reporter's verdict rule, in isolation (P06.10.07).
 *
 * `mutation-reporter.realvitest.test.ts` proves what Vitest and the wrapper really do. This file
 * pins the rule applied to what they reported: every way a probe record can be missing, stale,
 * self-doubting, mis-addressed, ineligible or ambiguous must fail closed, and no field of the
 * error may matter.
 */
import { describe, expect, it } from 'vitest';
import {
  MATCHER_IDENTITY_CONFIRMED,
  NON_EVIDENCE,
  PROBE_VERSION,
  type AssertionProbe,
} from '@moin/testing';
import {
  categoriseTest,
  reportError,
  type ReportedError,
  type TestIdentity,
} from './mutation-reporter.ts';
import { evidenceTest } from '@moin/testing';

const IDENTITY: TestIdentity = {
  file: 'packages/db/src/chain.integration.test.ts',
  fullName: 'the chain > rejects invalid chain',
};

/** A probe record for a confirmed, single, identity-checked matcher failure. */
function probe(overrides: Partial<AssertionProbe> = {}): AssertionProbe {
  return {
    version: PROBE_VERSION,
    event: MATCHER_IDENTITY_CONFIRMED,
    reason: 'the terminal value is the object assert threw',
    invocationId: 'pid-1',
    testFile: IDENTITY.file,
    testFullName: IDENTITY.fullName,
    evidenceEligible: true,
    matcherFailures: 1,
    matchers: ['assert'],
    expectCalls: 1,
    rejected: 0,
    suspect: [],
    ...overrides,
  };
}

/** Anything the code under test threw. The point is that its shape never matters. */
function thrown(extra: Record<string, unknown> = {}): ReportedError {
  return reportError({ name: 'Error', message: 'boom', ...extra });
}

describe('reportError', () => {
  it('records the name and message as diagnostics and can never say ASSERTION', () => {
    const spoof = reportError({
      name: 'AssertionError',
      message: 'expected 1 to be 2',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    });
    expect(spoof.name).toBe('AssertionError');
    // There is no code path in this function that produces an ASSERTION category.
    expect(spoof.category).toBe('ERROR');
    // And nothing resembling a credential is read off the value.
    expect(Object.keys(spoof).sort()).toStrictEqual(['category', 'message', 'name']);
  });

  it('identifies a timeout and a load failure from their own wording', () => {
    expect(reportError({ message: 'Test timed out in 5000ms.' }).category).toBe('TIMEOUT');
    expect(reportError({ message: 'Cannot find module x' }).category).toBe('LOAD');
    expect(reportError({ message: 'Transform failed with 1 error' }).category).toBe('LOAD');
  });

  it('survives a primitive, which a test is free to throw', () => {
    expect(reportError('a string').name).toBe('unknown');
    expect(reportError(undefined).category).toBe('ERROR');
    expect(reportError(7).message).toBe('');
  });

  it('strips escape sequences and keeps one line', () => {
    expect(reportError({ message: '\u001B[31mfirst line\u001B[39m\nsecond line' }).message).toBe(
      'first line',
    );
  });
});

describe('the ASSERTION verdict', () => {
  it('needs a confirmed, single, eligible matcher failure', () => {
    expect(categoriseTest([thrown()], probe(), IDENTITY)).toBe('ASSERTION');
  });

  evidenceTest('refuses an unconfirmed terminal value, whatever the error looks like', () => {
    const spoof = reportError({
      name: 'AssertionError',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    });
    expect(
      categoriseTest(
        [spoof],
        probe({ event: NON_EVIDENCE, reason: 'a copy is not the same object' }),
        IDENTITY,
      ),
    ).toBe('ERROR');
  });

  evidenceTest('refuses a test that is not registered for evidence', () => {
    expect(
      categoriseTest([thrown()], probe({ evidenceEligible: false, event: NON_EVIDENCE }), IDENTITY),
    ).toBe('NOT_ELIGIBLE');
  });

  it('reports ineligibility before looking at the event, so the reason stays the useful one', () => {
    // An unwrapped test can still have confirmed nothing; the honest answer is "not eligible".
    expect(categoriseTest([thrown()], probe({ evidenceEligible: false }), IDENTITY)).toBe(
      'NOT_ELIGIBLE',
    );
  });

  evidenceTest('fails closed when the probe is missing or from another contract version', () => {
    expect(categoriseTest([thrown()], undefined, IDENTITY)).toBe('UNKNOWN');
    expect(categoriseTest([thrown()], probe({ version: PROBE_VERSION + 1 }), IDENTITY)).toBe(
      'UNKNOWN',
    );
  });

  evidenceTest('fails closed when the probe doubts itself', () => {
    expect(
      categoriseTest(
        [thrown()],
        probe({ suspect: ['another invocation was still open'] }),
        IDENTITY,
      ),
    ).toBe('UNKNOWN');
    expect(categoriseTest([thrown()], probe({ rejected: 1 }), IDENTITY)).toBe('UNKNOWN');
  });

  evidenceTest('fails closed when the record names another test', () => {
    expect(categoriseTest([thrown()], probe({ testFile: 'other.test.ts' }), IDENTITY)).toBe(
      'UNKNOWN',
    );
    expect(categoriseTest([thrown()], probe({ testFullName: 'another name' }), IDENTITY)).toBe(
      'UNKNOWN',
    );
  });

  evidenceTest('fails closed on anything but exactly one matcher failure', () => {
    expect(categoriseTest([thrown()], probe({ matcherFailures: 0 }), IDENTITY)).toBe('UNKNOWN');
    expect(categoriseTest([thrown()], probe({ matcherFailures: 2 }), IDENTITY)).toBe('UNKNOWN');
  });

  it('never promotes a failure on the strength of expect having been called', () => {
    expect(
      categoriseTest(
        [thrown()],
        probe({ event: NON_EVIDENCE, matcherFailures: 0, expectCalls: 99 }),
        IDENTITY,
      ),
    ).toBe('ERROR');
  });

  evidenceTest('prefers a timeout or load verdict over anything else', () => {
    const timeout = reportError({ message: 'Test timed out in 300ms.' });
    const load = reportError({ message: 'Cannot find module x' });
    expect(categoriseTest([thrown(), timeout], probe(), IDENTITY)).toBe('TIMEOUT');
    expect(categoriseTest([thrown(), load], probe(), IDENTITY)).toBe('LOAD');
  });

  it('reports no errors as UNKNOWN rather than as a pass', () => {
    expect(categoriseTest([], probe(), IDENTITY)).toBe('UNKNOWN');
  });
});
