/**
 * The reporter's verdict rule, in isolation (P06.10.07).
 *
 * `mutation-reporter.realvitest.test.ts` proves what Vitest really does. This file pins the rule
 * applied to what Vitest reported: every way a probe record can be missing, stale, self-doubting,
 * mis-addressed or ambiguous must fail closed, and none of the error's own fields may matter.
 */
import { describe, expect, it } from 'vitest';
import {
  MATCHER_FAILURE,
  MATCHER_FAILURE_TOKEN,
  NO_MATCHER_FAILURE,
  PROBE_VERSION,
  type AssertionProbe,
} from './mutation-probe-contract.ts';
import {
  categoriseTest,
  reportError,
  type ReportedError,
  type TestIdentity,
} from './mutation-reporter.ts';

const IDENTITY: TestIdentity = {
  file: 'packages/db/src/chain.integration.test.ts',
  fullName: 'the chain > rejects invalid chain',
};
const TOKEN = 'pid-1:1';

/** A probe record for a genuine, single, propagated matcher failure. */
function probe(overrides: Partial<AssertionProbe> = {}): AssertionProbe {
  return {
    version: PROBE_VERSION,
    event: MATCHER_FAILURE,
    invocationId: 'pid-1',
    testFile: IDENTITY.file,
    testFullName: IDENTITY.fullName,
    matcherFailures: 1,
    matchers: ['assert'],
    failureTokens: [TOKEN],
    expectCalls: 1,
    rejected: 0,
    suspect: [],
    ...overrides,
  };
}

/** An error carrying the wrapper's token, as a propagated matcher failure does. */
function stamped(): ReportedError {
  return reportError({
    name: 'AssertionError',
    message: 'expected 1 to be 2',
    [MATCHER_FAILURE_TOKEN]: TOKEN,
  });
}

/** Anything the code under test threw. The point is that its shape never matters. */
function thrown(extra: Record<string, unknown> = {}): ReportedError {
  return reportError({ name: 'Error', message: 'boom', ...extra });
}

describe('reportError', () => {
  it('records the name and message as diagnostics and categorises neither as an assertion', () => {
    const spoof = reportError({
      name: 'AssertionError',
      message: 'expected 1 to be 2',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    });
    expect(spoof.name).toBe('AssertionError');
    // There is no code path in the reporter that turns an error into an ASSERTION on its own.
    expect(spoof.category).toBe('ERROR');
    expect(spoof.matcherToken).toBeUndefined();
  });

  it('reads the wrapper token when it is present, and only then', () => {
    expect(stamped().matcherToken).toBe(TOKEN);
    expect(thrown().matcherToken).toBeUndefined();
    expect(thrown({ [MATCHER_FAILURE_TOKEN]: 42 }).matcherToken).toBeUndefined();
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
    const reported = reportError({ message: '\u001B[31mfirst line\u001B[39m\nsecond line' });
    expect(reported.message).toBe('first line');
  });
});

describe('the ASSERTION verdict', () => {
  it('needs a trusted, single, propagated matcher failure', () => {
    expect(categoriseTest([stamped()], probe(), IDENTITY)).toBe('ASSERTION');
  });

  it('refuses a failure with no event, whatever the error looks like', () => {
    const spoof = reportError({
      name: 'AssertionError',
      expected: 1,
      actual: 2,
      showDiff: true,
      ok: false,
    });
    expect(
      categoriseTest([spoof], probe({ event: NO_MATCHER_FAILURE, matcherFailures: 0 }), IDENTITY),
    ).toBe('ERROR');
  });

  it('refuses a failure where the matcher passed but expect was called', () => {
    // `expectCalls` is diagnostic: a successful matcher plus any throw is not a kill.
    expect(
      categoriseTest(
        [thrown()],
        probe({ event: NO_MATCHER_FAILURE, matcherFailures: 0, failureTokens: [], expectCalls: 9 }),
        IDENTITY,
      ),
    ).toBe('ERROR');
  });

  it('fails closed when the probe is missing or from another contract version', () => {
    expect(categoriseTest([stamped()], undefined, IDENTITY)).toBe('UNKNOWN');
    expect(categoriseTest([stamped()], probe({ version: PROBE_VERSION + 1 }), IDENTITY)).toBe(
      'UNKNOWN',
    );
  });

  it('fails closed when the probe doubts itself', () => {
    expect(
      categoriseTest(
        [stamped()],
        probe({ suspect: ['another invocation was still open'] }),
        IDENTITY,
      ),
    ).toBe('UNKNOWN');
    expect(categoriseTest([stamped()], probe({ rejected: 1 }), IDENTITY)).toBe('UNKNOWN');
  });

  it('fails closed when the record names another test', () => {
    expect(categoriseTest([stamped()], probe({ testFile: 'other.test.ts' }), IDENTITY)).toBe(
      'UNKNOWN',
    );
    expect(categoriseTest([stamped()], probe({ testFullName: 'another name' }), IDENTITY)).toBe(
      'UNKNOWN',
    );
  });

  it('fails closed on anything but exactly one matcher failure', () => {
    expect(categoriseTest([stamped()], probe({ matcherFailures: 0 }), IDENTITY)).toBe('UNKNOWN');
    expect(categoriseTest([stamped()], probe({ matcherFailures: 2 }), IDENTITY)).toBe('UNKNOWN');
  });

  it('refuses an earned failure that the test swallowed', () => {
    // The event is real; the error that propagated carries no token, so it is not the one.
    expect(categoriseTest([thrown()], probe(), IDENTITY)).toBe('ERROR');
  });

  it('refuses a token that belongs to another invocation', () => {
    expect(categoriseTest([stamped()], probe({ failureTokens: ['pid-1:7'] }), IDENTITY)).toBe(
      'ERROR',
    );
  });

  it('prefers a timeout or load verdict over anything else', () => {
    const timeout = reportError({ message: 'Test timed out in 300ms.' });
    const load = reportError({ message: 'Cannot find module x' });
    expect(categoriseTest([stamped(), timeout], probe(), IDENTITY)).toBe('TIMEOUT');
    expect(categoriseTest([stamped(), load], probe(), IDENTITY)).toBe('LOAD');
  });

  it('reports no errors as UNKNOWN rather than as a pass', () => {
    expect(categoriseTest([], probe(), IDENTITY)).toBe('UNKNOWN');
  });
});
