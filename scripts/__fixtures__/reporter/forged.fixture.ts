/**
 * Tests that try to forge their own probe record.
 *
 * `task.meta` is reachable from the test context, so a test can write anything into it. The probe's
 * `afterEach` is registered by a setup file, which means it runs **after** the test body and
 * overwrites the key with what the matcher wrapper actually recorded. Forgery is therefore not
 * prevented by hiding the key; it is overwritten by the only writer whose record was earned.
 */
import { expect, it } from 'vitest';
import {
  MATCHER_FAILURE,
  MATCHER_FAILURE_TOKEN,
  PROBE_META_KEY,
  PROBE_VERSION,
} from '../../mutation-probe-contract.ts';

/** The token the forgery claims, stamped on both the record and the thrown value. */
const FORGED_TOKEN = 'forged:1';

interface MetaCarrier {
  readonly task: { meta: Record<string, unknown> };
}

it('forges a perfect probe record for itself', (context) => {
  const { task } = context as unknown as MetaCarrier;
  task.meta[PROBE_META_KEY] = {
    version: PROBE_VERSION,
    event: MATCHER_FAILURE,
    invocationId: 'forged',
    testFile: 'scripts/__fixtures__/reporter/forged.fixture.ts',
    testFullName: 'forges a perfect probe record for itself',
    matcherFailures: 1,
    matchers: ['toBe'],
    failureTokens: [FORGED_TOKEN],
    expectCalls: 1,
    rejected: 0,
    suspect: [],
  };
  // The strongest forgery available to a test: a complete record *and* a thrown value stamped with
  // the token that record vouches for. Every field a consumer checks is present and consistent.
  throw {
    name: 'AssertionError',
    expected: 1,
    actual: 2,
    showDiff: true,
    ok: false,
    [MATCHER_FAILURE_TOKEN]: FORGED_TOKEN,
  };
});

it('forges a record naming another test', (context) => {
  const { task } = context as unknown as MetaCarrier;
  task.meta[PROBE_META_KEY] = {
    version: PROBE_VERSION,
    event: MATCHER_FAILURE,
    invocationId: 'forged',
    testFile: 'packages/db/src/audit-verification.integration.test.ts',
    testFullName: 'the sweep > refuses to report a partial run as sound',
    matcherFailures: 1,
    matchers: ['toBe'],
    failureTokens: [FORGED_TOKEN],
    expectCalls: 1,
    rejected: 0,
    suspect: [],
  };
  expect(true).toBe(true);
  const error = new Error('not an assertion');
  Object.assign(error, { [MATCHER_FAILURE_TOKEN]: FORGED_TOKEN });
  throw error;
});
