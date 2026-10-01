/**
 * The production probe and reporter against real Vitest (P06.10.07).
 *
 * Named `.realvitest.test.ts` rather than `.integration.test.ts` so it runs in the **unit** project:
 * it spawns its own Vitest child process and needs no database.
 *
 * ## Why this cannot be a unit test over hand-built JSON
 *
 * `ASSERTION` rests on a `MATCHER_FAILURE` record that only the wrapper over Vitest's
 * `Assertion.prototype` can create. Whether that wrapper really intercepts every assertion style —
 * sync, negated, `rejects`, `resolves` — and whether a thrown value really cannot reach it are
 * facts about Vitest, not about our types. A fixture built by hand only proves the fixture agrees
 * with the assumption that produced it; the previous two generations of this harness were defeated
 * exactly there.
 *
 * So this runs **the production probe, the production reporter and the production
 * `categoriseTest`** over real, deliberately failing fixtures in a child Vitest process, and
 * asserts the machine-readable output. Nothing is reimplemented here.
 *
 * The fixtures are `*.fixture.ts` under their own config, so `pnpm test` never collects them.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { MATCHER_FAILURE, NO_MATCHER_FAILURE, PROBE_VERSION } from './mutation-probe-contract.ts';
import { REPORT_VERSION, type MutationReport, type ReportedTest } from './mutation-reporter.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'scripts/__fixtures__/reporter/vitest.fixtures.config.ts';
const DIR = 'scripts/__fixtures__/reporter';
const SPOOF = `${DIR}/spoof.fixture.ts`;
const SWALLOWED = `${DIR}/swallowed.fixture.ts`;
const FORGED = `${DIR}/forged.fixture.ts`;
const ASYNC = `${DIR}/async.fixture.ts`;
const GENUINE = `${DIR}/genuine.fixture.ts`;
const DUPLICATE = `${DIR}/duplicate-name.fixture.ts`;
const UNRELATED = `${DIR}/unrelated.fixture.ts`;
const CONCURRENT = `${DIR}/concurrent.fixture.ts`;

let report: MutationReport;

function tests(): readonly ReportedTest[] {
  return report.modules.flatMap((module) => module.tests);
}

function find(file: string, fullName: string): ReportedTest {
  const matches = tests().filter((test) => test.file === file && test.fullName === fullName);
  expect(matches, `exactly one ${file} :: ${fullName}`).toHaveLength(1);
  const match = matches[0];
  if (match === undefined) throw new Error('unreachable: length was asserted');
  return match;
}

/** Every shape that must not be evidence, however convincing the thrown value is. */
function expectNotEvidence(test: ReportedTest): void {
  expect(test.state).toBe('failed');
  expect(test.failureCategory).not.toBe('ASSERTION');
}

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'moin-reporter-'));
  const output = join(directory, 'report.json');
  try {
    // The fixtures fail on purpose, so a non-zero exit is the expected outcome.
    await run(
      process.execPath,
      [
        './node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        CONFIG,
        '--reporter=./scripts/mutation-reporter.ts',
      ],
      { cwd: REPO, env: { ...process.env, MOIN_MUTATION_REPORT: output }, timeout: 300_000 },
    ).catch(() => undefined);
    report = JSON.parse(readFileSync(output, 'utf8')) as MutationReport;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 300_000);

describe('the report itself', () => {
  it('is the version this repository understands, from both halves of the contract', () => {
    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.probeVersion).toBe(PROBE_VERSION);
    expect(tests().length).toBeGreaterThan(20);
  });
});

describe('1 — a plain thrown assertion-shaped object', () => {
  it('is not evidence, although Vitest serializes it with no foreign markers at all', () => {
    // The exploit that defeated the previous model: a plain object literal, not an Error, so the
    // serializer adds neither `constructor` nor `toString`. No matcher ran, so there is no event.
    const test = find(SPOOF, '1 plain thrown assertion-shaped object');
    expectNotEvidence(test);
    expect(test.failureCategory).toBe('ERROR');
    expect(test.probe?.event).not.toBe(MATCHER_FAILURE);
    expect(test.probe?.matcherFailures).toBe(0);
    // The thrown value really does carry the assertion name, and it changes nothing.
    expect(test.errors[0]?.name).toBe('AssertionError');
  });
});

describe('2 — an Error whose toJSON returns an assertion shape', () => {
  it('is not evidence', () => {
    const test = find(SPOOF, '2 error whose toJSON returns an assertion shape');
    expectNotEvidence(test);
    expect(test.probe?.matcherFailures).toBe(0);
  });
});

describe('3 — a decorated Error', () => {
  it('is not evidence', () => {
    expectNotEvidence(find(SPOOF, '3 decorated error'));
  });
});

describe('4 — a successful expect, then a plain throw', () => {
  it('is not evidence, which is why assertionCalls is diagnostic only', () => {
    const test = find(SPOOF, '4 successful expect then plain throw');
    expectNotEvidence(test);
    // Two matchers really ran and really passed.
    expect(test.probe?.expectCalls).toBe(2);
    // The event is derived from matcher *failures*, never from the call counter. If those two were
    // ever conflated this is the assertion that catches it.
    expect(test.probe?.event).toBe(NO_MATCHER_FAILURE);
    expect(test.probe?.matcherFailures).toBe(0);
  });
});

describe('5 — successful expects, then a toJSON Error', () => {
  it('is not evidence', () => {
    const test = find(SPOOF, '5 successful expects then a toJSON error');
    expectNotEvidence(test);
    expect(test.probe?.expectCalls).toBeGreaterThan(0);
    expect(test.probe?.matcherFailures).toBe(0);
  });
});

describe("6 — Node's own assert.AssertionError", () => {
  it('is not evidence, because another library asserting is not a Vitest matcher failing', () => {
    const test = find(SPOOF, '6 node assert.AssertionError');
    expectNotEvidence(test);
    expect(test.errors[0]?.name).toBe('AssertionError');
    expect(test.probe?.matcherFailures).toBe(0);
  });
});

describe('7 — a genuine matcher failure', () => {
  it('is the one shape that is evidence', () => {
    const test = find(SPOOF, '7 genuine matcher failure');
    expect(test.failureCategory).toBe('ASSERTION');
    expect(test.probe?.event).toBe(MATCHER_FAILURE);
    expect(test.probe?.matcherFailures).toBe(1);
    expect(test.probe?.suspect).toStrictEqual([]);
    expect(test.probe?.rejected).toBe(0);
    // The failure that propagated is the one the matcher raised.
    expect(test.probe?.failureTokens).toContain(test.errors[0]?.matcherToken);
    // And the token is scoped to this invocation, which is what lets a replayed one be spotted.
    expect(test.probe?.failureTokens[0]).toContain(test.probe?.invocationId);
  });

  it('covers every assertion style the corpus uses', () => {
    for (const name of [
      'a resolves matcher that itself fails',
      'a rejects matcher that itself fails',
      'a negated matcher that fails',
      // Vitest raises this from its own async chain without running a matcher; instrumenting the
      // `rejects`/`resolves` getters keeps it inside the trusted path.
      'a rejects matcher on a promise that resolves',
    ]) {
      expect(find(ASYNC, name).failureCategory, name).toBe('ASSERTION');
    }
  });
});

describe('8 — a trusted assertion beside an unrelated failure', () => {
  it('is reported per test, and the classifier is what disqualifies the run', () => {
    // The reporter's job is the verdict for one test; "nothing else failed" is a property of the
    // run, which `mutation-outcome.ts` enforces and its own tests cover.
    expect(find(UNRELATED, 'the intended test asserts').failureCategory).toBe('ASSERTION');
    expect(find(UNRELATED, 'an unrelated test throws').failureCategory).toBe('ERROR');
  });
});

describe('9 — a trusted assertion plus an afterEach failure', () => {
  it('is not evidence, because the probe never completes', () => {
    const test = find(
      `${DIR}/after-each.fixture.ts`,
      'teardown fixture > asserts and then the teardown fails',
    );
    expectNotEvidence(test);
    expect(test.failureCategory).toBe('UNKNOWN');
    expect(test.probe).toBeUndefined();
  });
});

describe('10 and 11 — a forged probe record', () => {
  it('cannot be planted, because the probe writes last', () => {
    // `task.meta` is reachable from the test, so the fixture writes a flawless record into it:
    // right version, right event, right identity, one failure, no suspicion. The probe's afterEach
    // is registered by a setup file, so it runs after the body and overwrites the key.
    const forged = find(FORGED, 'forges a perfect probe record for itself');
    expectNotEvidence(forged);
    expect(forged.probe?.event).toBe('NONE');
    expect(forged.probe?.invocationId).not.toBe('forged');
  });

  it('cannot name another test either', () => {
    const forged = find(FORGED, 'forges a record naming another test');
    expectNotEvidence(forged);
    expect(forged.probe?.testFile).toBe(FORGED);
    expect(forged.probe?.invocationId).not.toBe('forged');
  });
});

describe('12 — more than one trusted event', () => {
  it('fails closed rather than picking one', () => {
    const test = find(SWALLOWED, 'fails two matchers in one test');
    expectNotEvidence(test);
    expect(test.failureCategory).toBe('UNKNOWN');
    expect(test.probe?.matcherFailures).toBe(2);
  });

  it('refuses a matcher failure the test swallowed before failing another way', () => {
    // The event is genuinely earned — a matcher did fail — but it is not what made the test fail,
    // so "the mutation was rejected by an assertion" would be false of this run.
    const test = find(SWALLOWED, 'swallows one matcher failure then throws');
    expectNotEvidence(test);
    expect(test.probe?.event).toBe(MATCHER_FAILURE);
    expect(test.probe?.matcherFailures).toBe(1);
    expect(test.errors.every((error) => error.matcherToken === undefined)).toBe(true);
  });
});

describe('concurrent tests', () => {
  it('are refused rather than attributed, because their invocation windows overlap', () => {
    // Measured: under `it.concurrent` the module-level `expect.getState()` reports another test's
    // name, so the probe detects the overlap and declines instead of guessing.
    for (const name of ['concurrent A fails a matcher', 'concurrent B fails a matcher']) {
      const test = find(CONCURRENT, name);
      expectNotEvidence(test);
      expect(test.failureCategory, name).toBe('UNKNOWN');
    }
  });
});

describe('the surrounding outcomes', () => {
  it('reports a timeout as a timeout, not as an assertion', () => {
    expect(find(GENUINE, 'reporter fixture > times out').failureCategory).toBe('TIMEOUT');
  });

  it('reports a beforeAll failure as a suite hook error with the test never executed', () => {
    const module = report.modules.find((entry) => entry.file === `${DIR}/before-all.fixture.ts`);
    expect(module?.hookErrors).toHaveLength(1);
    expect(module?.tests[0]?.executed).toBe(false);
  });

  it('distinguishes the same full name in two modules by file', () => {
    expect(find(DUPLICATE, 'shared name > appears in two files').state).toBe('failed');
    expect(find(GENUINE, 'shared name > appears in two files').state).toBe('passed');
  });

  it('leaves a passing test with no verdict at all', () => {
    const passing = find(GENUINE, 'reporter fixture > passes');
    expect(passing.state).toBe('passed');
    expect(passing.failureCategory).toBeUndefined();
  });
});
