/**
 * That provenance is wired in, and that nothing copyable can stand in for it (P06.10.07).
 *
 * The probe fails closed: unloaded, every mutation becomes a non-evidence outcome rather than a
 * false kill. That is the right direction but it is silent — the corpus would simply stop proving
 * anything. So the wiring is asserted here, and so are the shapes of the mistake that has now been
 * made five times.
 *
 * The probe's *behaviour* is proven in `mutation-reporter.realvitest.test.ts`, against real Vitest.
 * It cannot be unit-tested here: loading it registers hooks and patches the matcher prototype of
 * this very file's assertions.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MATCHER_IDENTITY_CONFIRMED,
  NON_EVIDENCE,
  PROBE_VERSION,
} from './mutation-probe-contract.ts';
import { REPORT_VERSION } from './mutation-reporter.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = './scripts/mutation-evidence-probe.ts';

function read(relativePath: string): string {
  return readFileSync(join(REPO, relativePath), 'utf8');
}

/** The body of the one function that decides `ASSERTION`, and nothing around it. */
function verdictSource(): string {
  const reporter = read('scripts/mutation-reporter.ts');
  const start = reporter.indexOf('function categoriseTest');
  expect(start).toBeGreaterThan(0);
  const end = reporter.indexOf('\nfunction ', start + 1);
  expect(end).toBeGreaterThan(start);
  return reporter.slice(start, end);
}

describe('the probe wiring', () => {
  it('is loaded by both Vitest projects, so the sweep measures what CI runs', () => {
    const config = read('vitest.config.ts');
    expect(config.split(`setupFiles: ['${PROBE}']`)).toHaveLength(3);
    expect(config).toContain("name: 'unit'");
    expect(config).toContain("name: 'integration'");
  });

  it('is loaded by the reporter fixtures too, so they exercise the production path', () => {
    expect(read('scripts/__fixtures__/reporter/vitest.fixtures.config.ts')).toContain(PROBE);
  });

  it('is versioned on both sides, and the reporter pins the version it understands', () => {
    expect(PROBE_VERSION).toBeGreaterThan(0);
    expect(REPORT_VERSION).toBeGreaterThan(0);
    expect(verdictSource()).toContain('probe.version !== PROBE_VERSION');
  });

  it('has exactly one event that can mean evidence', () => {
    expect(MATCHER_IDENTITY_CONFIRMED).not.toBe(NON_EVIDENCE);
    expect(verdictSource()).toContain('probe.event !== MATCHER_IDENTITY_CONFIRMED');
  });
});

describe('no transferable credential', () => {
  it('leaves no token anywhere in the production harness', () => {
    // The fifth design stamped an enumerable token on the matcher's error, and
    // `Object.assign(new Error('x'), caught)` copied it onto an unrelated error, which counted.
    // A token is a credential, and a credential is copyable by whoever can read it.
    const production = [
      'scripts/mutation-probe-contract.ts',
      'scripts/mutation-evidence-state.ts',
      'scripts/mutation-evidence-probe.ts',
      'scripts/mutation-evidence-test.ts',
      'scripts/mutation-reporter.ts',
      'scripts/mutation-outcome.ts',
      'scripts/mutation-sweep.ts',
    ];
    for (const path of production) {
      const source = read(path);
      for (const forbidden of ['matcherToken', 'MATCHER_FAILURE_TOKEN', 'failureTokens']) {
        expect(source, `${forbidden} must not appear in ${path}`).not.toContain(forbidden);
      }
    }
  });

  it('never writes anything onto a thrown value', () => {
    // `record` sees the thrown object and deliberately does not touch it. A mark of any kind —
    // enumerable, symbol, random or signed — would be transferable.
    const state = read('scripts/mutation-evidence-state.ts');
    const record = state.slice(
      state.indexOf('function record('),
      state.indexOf('/** Open an invocation'),
    );
    expect(record).not.toContain('defineProperty');
    expect(record).not.toContain('Object.assign');
    // The one thing it does with the object is use it as a WeakMap key.
    expect(record).toContain('matcherFailures.set(error, entry)');
  });

  it('keeps the private map private', () => {
    const state = read('scripts/mutation-evidence-state.ts');
    expect(state).toContain('const matcherFailures = new WeakMap<object, MatcherFailure>()');
    // Not exported, and no reader is exported either: the only question answerable from outside is
    // the one `confirmTerminal` answers, about one exact object.
    expect(state).not.toContain('export const matcherFailures');
    expect(state).not.toMatch(/export function (get|has|read)Matcher/u);
  });

  it('hands out the recorder once, so a test cannot register an object of its own', () => {
    const state = read('scripts/mutation-evidence-state.ts');
    expect(state).toContain('if (recorderInstalled)');
    expect(read('scripts/mutation-evidence-probe.ts')).toContain('installMatcherRecorder()');
  });
});

describe('the verdict reads no field of the thrown value', () => {
  it('mentions none of the fields that were once authority', () => {
    const decision = verdictSource();
    for (const forbidden of [
      'foreignMarkers',
      'assertionFields',
      "=== 'AssertionError'",
      'expected',
      'showDiff',
      'constructor',
      'toString',
      'stack',
      'matcherToken',
    ]) {
      expect(decision, `${forbidden} must not appear in the verdict`).not.toContain(forbidden);
    }
  });

  it('keeps assertionCalls out of it as well', () => {
    expect(verdictSource()).not.toContain('expectCalls');
  });

  it('leaves the classifier with no access to probe internals at all', () => {
    const classifier = read('scripts/mutation-outcome.ts');
    expect(classifier).not.toContain('PROBE_META_KEY');
    expect(classifier).not.toContain('MATCHER_IDENTITY_CONFIRMED');
  });
});

describe('the trusted wrapper', () => {
  it('catches the terminal value and rethrows it unchanged', () => {
    const wrapper = read('scripts/mutation-evidence-test.ts');
    // The interception body only: the docblock names the copy attack in prose, which is the point.
    const intercept = wrapper.slice(
      wrapper.indexOf('function intercept('),
      wrapper.indexOf('/**', wrapper.indexOf('function intercept(')),
    );
    expect(intercept).toContain('confirmTerminal(terminal)');
    expect(intercept).toContain('throw terminal;');
    // Nothing is done to the value on the way through.
    expect(intercept).not.toContain('defineProperty');
    expect(intercept).not.toContain('Object.assign');
  });

  it('is the only thing that marks an invocation eligible', () => {
    expect(read('scripts/mutation-evidence-test.ts')).toContain('beginEvidence()');
    expect(read('scripts/mutation-evidence-probe.ts')).not.toContain('beginEvidence');
  });
});
