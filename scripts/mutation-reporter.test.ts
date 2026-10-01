/**
 * The reporter's error typing and verdict, in isolation (P06.10.07).
 *
 * `mutation-reporter.realvitest.test.ts` proves these shapes are what Vitest really emits. This
 * file proves the decision made from them, including the combinations real fixtures cannot easily
 * produce — a stale probe, a missing probe, a primitive thrown instead of an error.
 */
import { describe, expect, it } from 'vitest';
import { categoriseTest, reportError, type ReportedError } from './mutation-reporter.ts';
import { PROBE_VERSION, type AssertionProbe } from './mutation-probe-contract.ts';

/** `expect(1).toBe(2)`, exactly as Vitest serializes it. Copied from a measured run. */
const VITEST_ASSERTION = {
  message: 'expected 1 to be 2 // Object.is equality',
  actual: '1',
  expected: '2',
  showDiff: true,
  operator: 'strictEqual',
  diff: '- Expected\n+ Received',
  name: 'AssertionError',
  ok: false,
  stack: 'AssertionError: expected 1 to be 2\n    at ...',
  stacks: [],
};

/** A thrown `Error`. Vitest adds `constructor` and `toString` because it does not own the object. */
const FOREIGN_ERROR = {
  stack: 'Error: boom\n    at ...',
  message: 'connection refused while executing toThrow assertion',
  constructor: 'Function<Error>',
  name: 'Error',
  toString: 'Function<toString>',
  stacks: [],
};

/** The exploit: the same foreign error, decorated to look like an assertion. */
const SPOOFED = {
  ...FOREIGN_ERROR,
  name: 'AssertionError',
  expected: 'a',
  actual: 'b',
  showDiff: true,
  ok: false,
  operator: 'strictEqual',
};

function probe(expectCalls: number, version = PROBE_VERSION): AssertionProbe {
  return { version, expectCalls, recordedErrors: 1 };
}

describe('typing one error', () => {
  it('records the markers Vitest added, not a verdict', () => {
    const genuine = reportError(VITEST_ASSERTION);
    expect(genuine.name).toBe('AssertionError');
    expect(genuine.foreignMarkers).toStrictEqual([]);
    expect([...genuine.assertionFields].sort()).toStrictEqual([
      'actual',
      'expected',
      'ok',
      'showDiff',
    ]);
    // An individual error is never ASSERTION on its own: that needs the in-process signal too.
    expect(genuine.category).toBe('ERROR');
  });

  it('marks a foreign error as foreign however it is named', () => {
    for (const candidate of [FOREIGN_ERROR, SPOOFED]) {
      const typed = reportError(candidate);
      expect(typed.foreignMarkers).toStrictEqual(['constructor', 'toString']);
    }
  });

  it('identifies a timeout and a load failure from their own wording', () => {
    // Text, and sound here: both branches are outside the evidence count, and neither can reach
    // ASSERTION.
    expect(reportError({ name: 'Error', message: 'Test timed out in 300ms.' }).category).toBe(
      'TIMEOUT',
    );
    expect(reportError({ name: 'Error', message: 'Transform failed with 1 error' }).category).toBe(
      'LOAD',
    );
  });

  it('survives a primitive, which a test is free to throw', () => {
    for (const value of [undefined, null, 'a string', 42]) {
      const typed = reportError(value);
      expect(typed.name).toBe('unknown');
      expect(typed.assertionFields).toStrictEqual([]);
      expect(typed.foreignMarkers).toStrictEqual([]);
    }
  });

  it('strips escape sequences and keeps one line', () => {
    const typed = reportError({
      name: 'Error',
      message: '\u001B[31mTransform failed\u001B[0m\nwith 1 error\nmore',
    });
    expect(typed.message).toBe('Transform failed');
    // eslint-disable-next-line no-control-regex -- asserting the absence of escape sequences.
    expect(typed.message).not.toMatch(/\u001B\[/u);
  });
});

describe('the ASSERTION verdict', () => {
  const genuine: ReportedError = reportError(VITEST_ASSERTION);
  const spoofed: ReportedError = reportError(SPOOFED);
  const foreign: ReportedError = reportError(FOREIGN_ERROR);

  it('needs both signals', () => {
    expect(categoriseTest([genuine], probe(1))).toBe('ASSERTION');
  });

  it('refuses a decorated foreign error even when expect was called', () => {
    // The in-process counter alone would pass this; the foreign markers are what reject it.
    expect(categoriseTest([spoofed], probe(2))).toBe('ERROR');
  });

  it('refuses any failure where expect was never called', () => {
    expect(categoriseTest([genuine], probe(0))).toBe('ERROR');
    expect(categoriseTest([foreign], probe(0))).toBe('ERROR');
  });

  it('fails closed when the probe is missing or stale', () => {
    expect(categoriseTest([genuine], undefined)).toBe('UNKNOWN');
    expect(categoriseTest([genuine], probe(1, PROBE_VERSION + 1))).toBe('UNKNOWN');
  });

  it('refuses a mixed run: one genuine assertion and one foreign error', () => {
    // An `afterEach` that threw. The assertion may be real; the run is not clean evidence.
    expect(categoriseTest([genuine, foreign], probe(1))).toBe('ERROR');
    expect(categoriseTest([foreign, genuine], probe(1))).toBe('ERROR');
  });

  it('prefers a timeout or load verdict over anything else', () => {
    const timeout = reportError({ name: 'Error', message: 'Test timed out in 300ms.' });
    const load = reportError({ name: 'Error', message: 'Cannot find module x' });
    expect(categoriseTest([genuine, timeout], probe(1))).toBe('TIMEOUT');
    expect(categoriseTest([genuine, load], probe(1))).toBe('LOAD');
  });

  it('reports no errors as UNKNOWN rather than as a pass', () => {
    expect(categoriseTest([], probe(1))).toBe('UNKNOWN');
  });

  it('needs every assertion field, not merely the name', () => {
    for (const field of ['expected', 'actual', 'showDiff', 'ok'] as const) {
      const partial = Object.fromEntries(
        Object.entries(VITEST_ASSERTION).filter(([key]) => key !== field),
      );
      expect(categoriseTest([reportError(partial)], probe(1))).toBe('ERROR');
    }
  });

  it('needs the name too, not merely the fields', () => {
    const renamed = reportError({ ...VITEST_ASSERTION, name: 'Error' });
    expect(categoriseTest([renamed], probe(1))).toBe('ERROR');
  });
});
