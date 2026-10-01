/**
 * That the evidence probe is actually wired in, and that it is wired in everywhere (P06.10.07).
 *
 * The probe fails closed: with it unloaded, every mutation becomes a non-evidence outcome rather
 * than a false kill. That is the right direction, but it is silent — the corpus would simply stop
 * proving anything, and the report would say `ERROR` for 79 variants without anyone knowing why.
 * So the wiring is asserted, in the same place the sweep depends on it.
 *
 * The probe's *behaviour* is proven in `mutation-reporter.realvitest.test.ts`, against real Vitest.
 * It cannot be unit-tested here: loading it would register hooks and patch the matcher prototype of
 * this very file's assertions.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MATCHER_FAILURE,
  MATCHER_FAILURE_TOKEN,
  NO_MATCHER_FAILURE,
  PROBE_VERSION,
} from './mutation-probe-contract.ts';
import { REPORT_VERSION } from './mutation-reporter.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = './scripts/mutation-evidence-probe.ts';

function read(relativePath: string): string {
  return readFileSync(join(REPO, relativePath), 'utf8');
}

describe('the probe wiring', () => {
  it('is loaded by both Vitest projects, so the sweep measures what CI runs', () => {
    const config = read('vitest.config.ts');
    // Two projects, two setupFiles entries. A sweep over a project without the probe would report
    // every variant as a non-assertion failure.
    expect(config.split(`setupFiles: ['${PROBE}']`)).toHaveLength(3);
    expect(config).toContain("name: 'unit'");
    expect(config).toContain("name: 'integration'");
  });

  it('is loaded by the reporter fixtures too, so they exercise the production path', () => {
    expect(read('scripts/__fixtures__/reporter/vitest.fixtures.config.ts')).toContain(PROBE);
  });
});

describe('the probe contract', () => {
  it('is versioned on both sides, and the reporter pins the version it understands', () => {
    expect(PROBE_VERSION).toBeGreaterThan(0);
    expect(REPORT_VERSION).toBeGreaterThan(0);
    expect(read('scripts/mutation-reporter.ts')).toContain('probe.version !== PROBE_VERSION');
  });

  it('has exactly one event that can mean evidence', () => {
    expect(MATCHER_FAILURE).not.toBe(NO_MATCHER_FAILURE);
    expect(MATCHER_FAILURE_TOKEN.length).toBeGreaterThan(0);
  });
});

/** The body of the one function that decides `ASSERTION`, and nothing around it. */
function verdictSource(): string {
  const reporter = read('scripts/mutation-reporter.ts');
  const start = reporter.indexOf('function categoriseTest');
  expect(start).toBeGreaterThan(0);
  const end = reporter.indexOf('\nfunction ', start + 1);
  expect(end).toBeGreaterThan(start);
  return reporter.slice(start, end);
}

describe('the provenance rule', () => {
  it('keeps the thrown value out of the decision', () => {
    // A guard against the next well-meaning "small improvement". Each of these was once the
    // authority for KILLED_ASSERTION, and each was spoofed by a thrown value.
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
    ]) {
      expect(decision, `${forbidden} must not appear in the verdict`).not.toContain(forbidden);
    }
  });

  it('keeps assertionCalls out of it as well', () => {
    expect(verdictSource()).not.toContain('expectCalls');
  });

  it('is the only writer of a trusted event', () => {
    // Only the probe may construct the event. Anything else emitting `MATCHER_FAILURE` into a
    // task's meta would be a second, unearned source.
    const probe = read('scripts/mutation-evidence-probe.ts');
    expect(probe).toContain('meta[PROBE_META_KEY] = probe');
    const classifier = read('scripts/mutation-outcome.ts');
    expect(classifier).not.toContain('PROBE_META_KEY');
  });
});
