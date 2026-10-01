/**
 * The production probe, wrapper and reporter against real Vitest (P06.10.07).
 *
 * Named `.realvitest.test.ts` rather than `.integration.test.ts` so it runs in the **unit** project:
 * it spawns its own Vitest child process and needs no database.
 *
 * ## Why this cannot be a unit test over hand-built JSON
 *
 * `ASSERTION` rests on JavaScript object identity: the value that terminated the test body is, by
 * `===`, an object a Vitest matcher threw in this invocation. Whether a copy really is a different
 * object *as Vitest reports it*, whether the matcher wrapper really intercepts every assertion
 * style, and whether a planted record really is overwritten are facts about Vitest and about this
 * harness together. A fixture built by hand only proves the fixture agrees with the assumption that
 * produced it — which is exactly where the previous three designs were defeated.
 *
 * So this runs **the production probe, the production wrapper, the production reporter and the
 * production `categoriseTest`** over real, deliberately failing fixtures in a child Vitest process,
 * and asserts the machine-readable output. Nothing is reimplemented here.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MATCHER_IDENTITY_CONFIRMED,
  NON_EVIDENCE,
  PROBE_VERSION,
} from './mutation-probe-contract.ts';
import { REPORT_VERSION, type MutationReport, type ReportedTest } from './mutation-reporter.ts';
import { evidenceTest } from './mutation-evidence-test.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'scripts/__fixtures__/reporter/vitest.fixtures.config.ts';
const DIR = 'scripts/__fixtures__/reporter';
const IDENTITY = `${DIR}/identity.fixture.ts`;
const CROSS = `${DIR}/cross-invocation.fixture.ts`;
const ELIGIBILITY = `${DIR}/eligibility.fixture.ts`;
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

/** Failed, and not evidence, however convincing the thrown value was. */
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
    expect(tests().length).toBeGreaterThan(25);
  });
});

describe('1 — the token-copy attack', () => {
  evidenceTest('fails because a copy is a different object', () => {
    // `Object.assign(new Error('ordinary'), caught)` is what broke the previous design, when
    // provenance was a field on the error. Identity cannot be assigned.
    const test = find(IDENTITY, '1 token-copy equivalent: Object.assign onto an ordinary Error');
    expectNotEvidence(test);
    expect(test.failureCategory).toBe('ERROR');
    expect(test.probe?.event).toBe(NON_EVIDENCE);
    expect(test.probe?.reason).toMatch(/not the same object/u);
    // A matcher really did fail in this invocation. It just was not what terminated the test.
    expect(test.probe?.matcherFailures).toBe(1);
  });
});

describe('2 — every own property and symbol copied', () => {
  it('still fails, because nothing copyable carries provenance', () => {
    const test = find(IDENTITY, '2 every own property and symbol copied onto another Error');
    expectNotEvidence(test);
    expect(test.probe?.reason).toMatch(/not the same object/u);
  });
});

describe('3 — a clone with the same prototype, name, message and stack', () => {
  it('fails', () => {
    const test = find(IDENTITY, '3 a clone with the same prototype, name, message and stack');
    expectNotEvidence(test);
    expect(test.probe?.reason).toMatch(/not the same object/u);
  });
});

describe('4 — async transfer', () => {
  it('fails, because awaiting does not launder identity', () => {
    const test = find(IDENTITY, '4 async transfer: await, then throw a copy');
    expectNotEvidence(test);
    expect(test.probe?.reason).toMatch(/not the same object/u);
  });
});

describe('5 — the same matcher object rethrown', () => {
  evidenceTest('is evidence, and is the shape every real killing test has', () => {
    const test = find(IDENTITY, '5 the same matcher object rethrown immediately');
    expect(test.failureCategory).toBe('ASSERTION');
    expect(test.probe?.event).toBe(MATCHER_IDENTITY_CONFIRMED);
    expect(test.probe?.evidenceEligible).toBe(true);
    expect(test.probe?.matcherFailures).toBe(1);
    expect(test.probe?.suspect).toStrictEqual([]);
    expect(test.probe?.rejected).toBe(0);
  });
});

describe('6 — the same matcher object thrown later in the invocation', () => {
  it('is evidence, which is the intended semantics while exactly one matcher failed', () => {
    const test = find(IDENTITY, '6 the same matcher object thrown later in the same invocation');
    expect(test.failureCategory).toBe('ASSERTION');
    expect(test.probe?.matcherFailures).toBe(1);
  });
});

describe('7 — a swallowed matcher failure then an ordinary error', () => {
  it('is not evidence', () => {
    const test = find(IDENTITY, '7 a swallowed matcher failure, then an ordinary error');
    expectNotEvidence(test);
    expect(test.probe?.matcherFailures).toBe(1);
    expect(test.probe?.reason).toMatch(/not the same object/u);
  });
});

describe('8 — a matcher object from another test', () => {
  evidenceTest('is rejected by invocation identity', () => {
    const test = find(CROSS, '8b test B throws test A matcher object');
    expectNotEvidence(test);
    expect(test.probe?.reason).toMatch(/belongs to invocation/u);
  });
});

describe('9 — a matcher object from a previous attempt of the same test', () => {
  it('is rejected, because a retry is a new invocation', () => {
    const test = find(CROSS, '9 a retried test reuses the first attempt matcher object');
    expectNotEvidence(test);
    expect(test.probe?.reason).toMatch(/belongs to invocation/u);
  });
});

describe('10 — a matcher object from another parameterized case', () => {
  it('is rejected, while the case that earned it is evidence', () => {
    expect(find(CROSS, '10 parameterized case a').failureCategory).toBe('ASSERTION');
    const replayed = find(CROSS, '10 parameterized case b');
    expectNotEvidence(replayed);
    expect(replayed.probe?.reason).toMatch(/belongs to invocation/u);
  });
});

describe('11 — two matcher failures in one invocation', () => {
  evidenceTest('fails closed rather than picking one', () => {
    const test = find(IDENTITY, '11 two matcher failures in one invocation');
    expectNotEvidence(test);
    expect(test.probe?.matcherFailures).toBe(2);
    expect(test.probe?.reason).toMatch(/cannot be established/u);
  });
});

describe('12 — concurrent invocations', () => {
  evidenceTest('fail closed, because their windows overlap', () => {
    // Measured: under `it.concurrent` the module-level `expect.getState()` reports another test's
    // name, so the probe detects the overlap and declines instead of guessing.
    for (const name of ['concurrent A fails a matcher', 'concurrent B fails a matcher']) {
      const test = find(CONCURRENT, name);
      expectNotEvidence(test);
      expect(test.failureCategory, name).toBe('UNKNOWN');
    }
  });
});

describe('the shapes that defeated earlier designs', () => {
  evidenceTest('are all refused, and none of them involves a matcher failing', () => {
    for (const name of [
      '13 plain thrown assertion-shaped object',
      '14 an Error whose toJSON returns an assertion shape',
      '15 a successful expect, then a plain throw',
      "16 Node's own assert.AssertionError",
    ]) {
      const test = find(IDENTITY, name);
      expectNotEvidence(test);
      expect(test.probe?.matcherFailures, name).toBe(0);
    }
  });

  it('includes a successful expect, so the call counter is only ever diagnostic', () => {
    const test = find(IDENTITY, '15 a successful expect, then a plain throw');
    expect(test.probe?.expectCalls).toBe(2);
    expect(test.probe?.matcherFailures).toBe(0);
  });
});

describe('a forged probe record', () => {
  evidenceTest('cannot be planted, because the probe writes last', () => {
    // The fixture writes a flawless record into its own `task.meta`: right version, right event,
    // right identity, one failure, no suspicion. A setup file's `afterEach` runs after the body.
    const test = find(IDENTITY, '17 a forged probe record planted in task.meta');
    expectNotEvidence(test);
    expect(test.probe?.event).toBe(NON_EVIDENCE);
    expect(test.probe?.invocationId).not.toBe('forged');
    expect(test.probe?.reason).not.toBe('forged');
  });
});

describe('the trusted wrapper', () => {
  evidenceTest('is what makes a test eligible at all', () => {
    const unwrapped = find(ELIGIBILITY, 'an unwrapped test with a genuine matcher failure');
    expect(unwrapped.failureCategory).toBe('NOT_ELIGIBLE');
    expect(unwrapped.probe?.evidenceEligible).toBe(false);
    // The matcher genuinely failed; there was simply nothing left to compare by the time any hook
    // ran, which is why eligibility is not a formality.
    expect(unwrapped.probe?.matcherFailures).toBe(1);

    const wrapped = find(ELIGIBILITY, 'a wrapped test with a genuine matcher failure');
    expect(wrapped.failureCategory).toBe('ASSERTION');
    expect(wrapped.probe?.evidenceEligible).toBe(true);
  });

  evidenceTest('covers every assertion style the corpus uses', () => {
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

  it('leaves an ordinary thrown error as an ordinary failure', () => {
    const test = find(GENUINE, 'reporter fixture > ordinary thrown error');
    expectNotEvidence(test);
    expect(test.probe?.matcherFailures).toBe(0);
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

  it('refuses an assertion whose afterEach then failed, because no record is attached', () => {
    const test = find(
      `${DIR}/after-each.fixture.ts`,
      'teardown fixture > asserts and then the teardown fails',
    );
    expectNotEvidence(test);
    expect(test.failureCategory).toBe('UNKNOWN');
    expect(test.probe).toBeUndefined();
  });

  it('distinguishes the same full name in two modules by file', () => {
    expect(find(DUPLICATE, 'shared name > appears in two files').state).toBe('failed');
    expect(find(GENUINE, 'shared name > appears in two files').state).toBe('passed');
  });

  it('reports the intended and the unrelated failure separately', () => {
    expect(find(UNRELATED, 'the intended test asserts').failureCategory).toBe('ASSERTION');
    expect(find(UNRELATED, 'an unrelated test throws').failureCategory).toBe('ERROR');
  });

  it('leaves a passing test with no verdict at all', () => {
    const passing = find(GENUINE, 'reporter fixture > passes');
    expect(passing.state).toBe('passed');
    expect(passing.failureCategory).toBeUndefined();
  });
});
