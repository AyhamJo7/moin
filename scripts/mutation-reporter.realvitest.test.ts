/**
 * The reporter against real Vitest (P06.10.07).
 *
 * Named `.realvitest.test.ts` rather than `.integration.test.ts` so it runs in the **unit** project:
 * it spawns its own Vitest child process and needs no database, and the integration project would
 * make it wait for a PostgreSQL template it never touches.
 *
 * The reporter's `ASSERTION` verdict rests on two signals, and one of them — that Vitest's
 * serializer adds `constructor`/`toString` to errors it does not own — is observed behaviour rather
 * than a documented contract. Hand-written fixtures cannot pin observed behaviour: they only prove
 * the fixture agrees with the assumption that produced it.
 *
 * So this runs the real reporter over real deliberately-failing fixtures, in a child Vitest process
 * with its own config, and asserts the machine-readable output. If a Vitest upgrade changes how
 * errors are serialized, this fails loudly instead of the harness quietly accepting spoofs.
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
import { REPORT_VERSION, type MutationReport, type ReportedTest } from './mutation-reporter.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'scripts/__fixtures__/reporter/vitest.fixtures.config.ts';
const GENUINE = 'scripts/__fixtures__/reporter/genuine.fixture.ts';
const DUPLICATE = 'scripts/__fixtures__/reporter/duplicate-name.fixture.ts';

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
      { cwd: REPO, timeout: 300_000, env: { ...process.env, MOIN_MUTATION_REPORT: output } },
    ).catch(() => undefined);
    report = JSON.parse(readFileSync(output, 'utf8')) as MutationReport;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 300_000);

describe('what real Vitest emits', () => {
  it('writes a report this classifier version understands', () => {
    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.unhandledErrors).toStrictEqual([]);
    expect(report.modules.length).toBeGreaterThanOrEqual(4);
  });

  it('categorises a genuine assertion failure as ASSERTION', () => {
    const test = find(GENUINE, 'reporter fixture > genuine assertion failure');
    expect(test.failureCategory).toBe('ASSERTION');
    expect(test.probe?.expectCalls).toBe(1);
    // The signal that makes it trustworthy: Vitest owns this error, so it added no foreign markers.
    expect(test.errors[0]?.foreignMarkers).toStrictEqual([]);
    expect(test.errors[0]?.assertionFields).toHaveLength(4);
  });

  it('refuses a plain Error decorated to look exactly like an assertion', () => {
    // The reported exploit, run for real: name = AssertionError plus expected/actual/showDiff/ok.
    const test = find(GENUINE, 'reporter fixture > spoofed assertion object');
    expect(test.failureCategory).toBe('ERROR');
    expect(test.failureCategory).not.toBe('ASSERTION');
    // Both signals reject it independently: `expect` was never called, and Vitest marked the
    // object foreign because it is not one of its own.
    expect(test.probe?.expectCalls).toBe(0);
    expect(test.errors[0]?.name).toBe('AssertionError');
    expect(test.errors[0]?.assertionFields).toHaveLength(4);
    expect(test.errors[0]?.foreignMarkers).toStrictEqual(['constructor', 'toString']);
  });

  it('refuses a decorated throw even when expect really was called first', () => {
    // This is why the in-process counter alone is not sufficient: two successful assertions, then
    // a decorated throw. Only the foreign markers distinguish it.
    const test = find(GENUINE, 'reporter fixture > passing expects then a decorated throw');
    expect(test.probe?.expectCalls).toBe(2);
    expect(test.failureCategory).toBe('ERROR');
  });

  it('categorises an ordinary thrown error as ERROR', () => {
    const test = find(GENUINE, 'reporter fixture > ordinary thrown error');
    expect(test.failureCategory).toBe('ERROR');
    expect(test.probe?.expectCalls).toBe(0);
  });

  it('categorises a hung test as TIMEOUT rather than as an assertion', () => {
    const test = find(GENUINE, 'reporter fixture > times out');
    expect(test.failureCategory).toBe('TIMEOUT');
  });

  it('leaves a passing test uncategorised and marks it executed', () => {
    const test = find(GENUINE, 'reporter fixture > passes');
    expect(test.state).toBe('passed');
    expect(test.executed).toBe(true);
    expect(test.failureCategory).toBeUndefined();
  });
});

describe('failures that are not a test failing', () => {
  it('reports a beforeAll throw as a suite hook error, with its test not executed', () => {
    const module = report.modules.find((entry) => entry.file.endsWith('before-all.fixture.ts'));
    expect(module?.hookErrors).toHaveLength(1);
    expect(module?.hookErrors[0]?.category).toBe('ERROR');
    const test = module?.tests[0];
    expect(test?.state).toBe('skipped');
    expect(test?.executed).toBe(false);
    expect(test?.failureCategory).toBeUndefined();
  });

  it('refuses to categorise a test whose teardown threw', () => {
    // Measured: when an `afterEach` throws, the probe never records, so the reporter has no
    // in-process signal and falls through to UNKNOWN. Fail-closed is the whole design.
    const test = find(
      'scripts/__fixtures__/reporter/after-each.fixture.ts',
      'teardown fixture > asserts and then the teardown fails',
    );
    expect(test.state).toBe('failed');
    expect(test.failureCategory).not.toBe('ASSERTION');
    expect(test.failureCategory).toBe('UNKNOWN');
    expect(test.probe).toBeUndefined();
  });
});

describe('canonical identity', () => {
  it('distinguishes the same exact full name in two files', () => {
    const shared = 'shared name > appears in two files';
    const inGenuine = find(GENUINE, shared);
    const inDuplicate = find(DUPLICATE, shared);
    expect(inGenuine.fullName).toBe(inDuplicate.fullName);
    expect(inGenuine.file).not.toBe(inDuplicate.file);
    // One passes, one fails — so a name-only match would pick the wrong verdict half the time.
    expect(inGenuine.state).toBe('passed');
    expect(inDuplicate.state).toBe('failed');
    expect(inDuplicate.failureCategory).toBe('ASSERTION');
  });

  it('reports repository-relative module paths, which the manifest can be written against', () => {
    for (const test of tests()) {
      expect(test.file.startsWith('/')).toBe(false);
      expect(test.file).toMatch(/^scripts\/__fixtures__\/reporter\/[\w-]+\.fixture\.ts$/u);
    }
  });
});
