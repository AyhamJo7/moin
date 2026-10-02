/**
 * One sweep per worktree (P06.10.07).
 *
 * Two sweeps in one worktree both passed the pristine check and then took turns writing one file.
 * Reproduced here before the fix, with the review's shape — M1 and M5 in the same file, sharing a
 * killing test: A's mutant run observed **M5's** bytes, B's baseline observed A's M1, B's mutant run
 * observed the pristine file, both reported `KILLED_ASSERTION`, and the file ended pristine, so every
 * per-variant check passed.
 *
 * The sweeps here are real `runSweep` orchestrations in separate Node processes
 * (`__fixtures__/sweep/paused-driver.ts`). Only Vitest is replaced, by an observer that records the
 * bytes on disk at the moment a test would have run — which is what "ran against its own mutant"
 * means — and that can be held at a named point so the interleaving is deterministic.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Classification } from './mutation-outcome.ts';
import {
  acquireSweepLock,
  applyMutation,
  runSweep,
  SourceIntegrityError,
  SWEEP_LOCK_EXIT,
  SweepLockError,
  sweepLockPath,
  type Observe,
  type Variant,
  type WriteFile,
} from './mutation-sweep.ts';
import { evidenceTest } from '@moin/testing';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = join(REPO, 'scripts', 'mutation-sweep.ts');
const DRIVER = join(REPO, 'scripts', '__fixtures__', 'sweep', 'paused-driver.ts');
const CHILD_TIMEOUT_MS = 30_000;
const POLL_MS = 10;
const CONTENDERS = 8;

/** Nothing from an enclosing Git hook may point these repositories somewhere else. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

const A = 'export const one = 1;\nexport const five = 5;\n';
const B = 'export const other = 0;\n';
const KILLING_TEST = { file: 'shared.test.ts', fullName: 'one shared killing test' };

function variant(id: string, file: string, find: string, replace: string): Variant {
  return {
    id,
    invariant: `test invariant for ${id}`,
    expected: 'a test fixture',
    file,
    find,
    replace,
    killingTest: KILLING_TEST,
    project: 'unit',
  };
}

/** The review's pair: the same file, the same killing test. */
const M1 = variant('M1', 'src/a.ts', 'export const one = 1;', 'export const one = 100;');
const M5 = variant('M5', 'src/a.ts', 'export const five = 5;', 'export const five = 500;');
const MB = variant('MB', 'src/b.ts', 'export const other = 0;', 'export const other = 9;');
const MANIFEST = [M1, M5, MB];
const M1_APPLIED = 'export const one = 100;\nexport const five = 5;\n';
const M5_APPLIED = 'export const one = 1;\nexport const five = 500;\n';

const directories: string[] = [];
const children = new Set<ReturnType<typeof spawn>>();
afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
}

function repository(): string {
  const root = temporary('moin-lock-');
  git(root, ['init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.ts'), A);
  writeFileSync(join(root, 'src/b.ts'), B);
  git(root, ['add', '-A']);
  git(root, [
    '-c',
    'user.name=sweep-test',
    '-c',
    'user.email=sweep-test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '--no-verify',
    '-m',
    'pristine',
  ]);
  return root;
}

interface Driver {
  readonly name: string;
  readonly pid: number;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** One real sweep, in its own process, held at `pauses`. */
function startDriver(
  root: string,
  control: string,
  name: string,
  selected: readonly string[],
  pauses: readonly string[] = [],
): Driver {
  const child = spawn(
    process.execPath,
    [DRIVER, root, name, control, JSON.stringify(MANIFEST), selected.join(','), pauses.join(',')],
    { cwd: REPO, env: ENV, stdio: 'ignore' },
  );
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle) => {
    child.on('exit', (code, signal) => {
      children.delete(child);
      settle({ code, signal });
    });
  });
  if (child.pid === undefined) throw new Error('the driver did not start');
  return { name, pid: child.pid, exited };
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

function marker(control: string, name: string, point: string, suffix: 'paused' | 'go'): string {
  return join(control, `${name}.${point.replace(':', '.')}.${suffix}`);
}

async function paused(control: string, driver: Driver, point: string): Promise<void> {
  await until(
    () => existsSync(marker(control, driver.name, point, 'paused')),
    `${driver.name} at ${point}`,
  );
}

function release(control: string, driver: Driver, point: string): void {
  writeFileSync(marker(control, driver.name, point, 'go'), '');
}

interface LogEntry {
  readonly event: 'enter' | 'observed';
  readonly point: string;
  readonly content?: string;
}

function log(control: string, name: string): LogEntry[] {
  const path = join(control, `${name}.log`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LogEntry);
}

function done(
  control: string,
  name: string,
): { status: string; name?: string; message?: string; outcomes?: string[] } {
  return JSON.parse(readFileSync(join(control, `${name}.done.json`), 'utf8')) as {
    status: string;
    name?: string;
    message?: string;
    outcomes?: string[];
  };
}

function cli(
  root: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  const manifest = join(temporary('moin-lock-manifest-'), 'manifest.json');
  writeFileSync(manifest, JSON.stringify(MANIFEST));
  const result = spawnSync(
    process.execPath,
    [SWEEP, '--root', root, '--manifest', manifest, ...args],
    {
      cwd: REPO,
      env: ENV,
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('two sweeps in one worktree', () => {
  evidenceTest(
    'the second is refused before any baseline, and the first observes only its own mutant',
    async () => {
      const root = repository();
      const control = temporary('moin-lock-control-');

      // A owns the lock and is held at the start of its first baseline, before writing anything.
      const first = startDriver(root, control, 'A', ['M1'], ['baseline:M1', 'mutant:M1']);
      await paused(control, first, 'baseline:M1');

      // B is the review's second sweep: M5, the same file, the same killing test. Wait until it is
      // either refused or held at its own baseline — never for its exit, which an unrefused B
      // would not reach.
      const second = startDriver(root, control, 'B', ['M5'], ['baseline:M5', 'mutant:M5']);
      await until(
        () =>
          existsSync(join(control, 'B.done.json')) ||
          existsSync(marker(control, 'B', 'baseline:M5', 'paused')),
        'B to be refused or to reach its baseline',
      );
      // B never reached its observer: no baseline, no mutant, no result.
      expect(log(control, 'B')).toStrictEqual([]);
      expect(await second.exited).toStrictEqual({ code: SWEEP_LOCK_EXIT, signal: null });
      const refusal = done(control, 'B');
      expect(refusal.name).toBe('SweepLockError');
      expect(refusal.message).toMatch(/mutation sweep lock already held for this worktree/u);
      expect(refusal.message).toContain(`pid ${String(first.pid)}`);
      expect(refusal.outcomes).toBeUndefined();
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);

      // The lock B met is A's, by its owner record.
      const ownerRecord = join(sweepLockPath(root), 'owner.json');
      expect(existsSync(ownerRecord)).toBe(true);
      expect((JSON.parse(readFileSync(ownerRecord, 'utf8')) as { pid: number }).pid).toBe(
        first.pid,
      );

      // A continues, and its test runs against exactly its own mutant.
      release(control, first, 'baseline:M1');
      await paused(control, first, 'mutant:M1');
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(M1_APPLIED);
      release(control, first, 'mutant:M1');
      expect(await first.exited).toStrictEqual({ code: 0, signal: null });

      expect(
        log(control, 'A')
          .filter((entry) => entry.event === 'observed')
          .map((entry) => [entry.point, entry.content]),
      ).toStrictEqual([
        ['baseline:M1', A],
        ['mutant:M1', M1_APPLIED],
      ]);
      expect(done(control, 'A').outcomes).toStrictEqual(['KILLED_ASSERTION']);
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
      expect(existsSync(sweepLockPath(root))).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'refuses a second CLI sweep by the lock, not by the source, while the first has a mutant on disk',
    async () => {
      const root = repository();
      const control = temporary('moin-lock-control-');
      const first = startDriver(root, control, 'A', ['M1'], ['mutant:M1']);
      await paused(control, first, 'mutant:M1');

      const second = cli(root, ['--only', 'M5']);
      // Exit 4, not 3: the lock is taken before any source is read, so the refusal says why.
      expect(second.status).toBe(SWEEP_LOCK_EXIT);
      expect(second.stderr).toMatch(/lock already held for this worktree/u);
      expect(second.stdout).not.toMatch(/KILLED|SURVIVED|BASELINE|INVALID/u);
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(M1_APPLIED);

      release(control, first, 'mutant:M1');
      expect((await first.exited).code).toBe(0);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    `admits exactly one of ${String(CONTENDERS)} sweeps started at once`,
    async () => {
      const root = repository();
      const control = temporary('moin-lock-control-');
      const names = Array.from({ length: CONTENDERS }, (_, index) => `C${String(index)}`);
      const index = (name: string): number => Number(name.slice(1));
      const drivers = names.map((name) =>
        startDriver(
          root,
          control,
          name,
          [index(name) % 2 === 0 ? 'M1' : 'M5'],
          ['baseline:M1', 'baseline:M5'],
        ),
      );
      const settledOrHeld = (driver: Driver): boolean =>
        existsSync(join(control, `${driver.name}.done.json`)) ||
        existsSync(marker(control, driver.name, 'baseline:M1', 'paused')) ||
        existsSync(marker(control, driver.name, 'baseline:M5', 'paused'));
      await until(() => drivers.every(settledOrHeld), 'every contender to own or be refused');

      const owners = drivers.filter(
        (driver) => !existsSync(join(control, `${driver.name}.done.json`)),
      );
      expect(owners).toHaveLength(1);
      for (const refused of drivers.filter((driver) => !owners.includes(driver))) {
        expect(done(control, refused.name).name).toBe('SweepLockError');
        expect(log(control, refused.name)).toStrictEqual([]);
        expect((await refused.exited).code).toBe(SWEEP_LOCK_EXIT);
      }

      const [owner] = owners;
      if (owner === undefined) throw new Error('unreachable: one owner was asserted');
      for (const point of ['baseline:M1', 'baseline:M5']) release(control, owner, point);
      expect((await owner.exited).code).toBe(0);
      expect(existsSync(sweepLockPath(root))).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'releases the lock on SIGINT while held at a baseline',
    async () => {
      const root = repository();
      const control = temporary('moin-lock-control-');
      const first = startDriver(root, control, 'A', ['M1'], ['baseline:M1']);
      await paused(control, first, 'baseline:M1');
      expect(existsSync(sweepLockPath(root))).toBe(true);
      process.kill(first.pid, 'SIGINT');
      expect((await first.exited).code).toBe(130);
      expect(existsSync(sweepLockPath(root))).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe('the lock is per worktree', () => {
  evidenceTest(
    'a linked worktree sweeps while the main worktree is locked',
    async () => {
      const root = repository();
      const linked = join(temporary('moin-lock-linked-'), 'wt');
      git(root, ['worktree', 'add', '-q', '--detach', linked]);
      const control = temporary('moin-lock-control-');

      // Each worktree's own Git directory, so the two locks are different paths.
      expect(sweepLockPath(linked)).not.toBe(sweepLockPath(root));
      expect(sweepLockPath(root)).toBe(join(root, '.git', 'moin-mutation-sweep.lock'));
      expect(sweepLockPath(linked)).toMatch(
        /[/\\]\.git[/\\]worktrees[/\\][^/\\]+[/\\]moin-mutation-sweep\.lock$/u,
      );

      const main = startDriver(root, control, 'A', ['M1'], ['baseline:M1']);
      await paused(control, main, 'baseline:M1');

      const other = startDriver(linked, control, 'B', ['M5']);
      expect(await other.exited).toStrictEqual({ code: 0, signal: null });
      expect(done(control, 'B').outcomes).toStrictEqual(['KILLED_ASSERTION']);
      const mutantRun = log(control, 'B').find(
        (entry) => entry.point === 'mutant:M5' && entry.event === 'observed',
      );
      expect(mutantRun?.content).toBe(M5_APPLIED);
      // The main worktree's file was never touched.
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);

      release(control, main, 'baseline:M1');
      expect((await main.exited).code).toBe(0);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe('a sweep killed outright', () => {
  evidenceTest(
    'leaves its lock, so the next sweep refuses; after manual removal the pristine check refuses',
    async () => {
      const root = repository();
      const control = temporary('moin-lock-control-');
      const killed = startDriver(root, control, 'A', ['M1'], ['mutant:M1']);
      await paused(control, killed, 'mutant:M1');
      process.kill(killed.pid, 'SIGKILL');
      expect((await killed.exited).signal).toBe('SIGKILL');

      // Nothing ran on the way out: the lock and the mutant are both still there.
      const lock = sweepLockPath(root);
      expect(existsSync(lock)).toBe(true);
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(M1_APPLIED);

      // The next sweep refuses on the lock, however it is started, and says how to recover.
      for (const args of [['--only', 'M5'], ['--only', 'MB'], ['--validate']]) {
        const refused = cli(root, args);
        expect(refused.status, args.join(' ')).toBe(SWEEP_LOCK_EXIT);
        expect(refused.stderr).toContain(`pid ${String(killed.pid)}`);
        expect(refused.stderr).toMatch(/If no sweep is running/u);
      }
      expect(existsSync(lock)).toBe(true);

      // Recovery, as documented: confirm the holder is gone, then remove the lock by hand.
      expect(() => process.kill(killed.pid, 0)).toThrow();
      rmSync(lock, { recursive: true });

      // The second protection: the leftover mutant is still refused.
      const contaminated = cli(root, ['--only', 'M5']);
      expect(contaminated.status).toBe(3);
      expect(contaminated.stderr).toMatch(/not pristine at expected HEAD .*src\/a\.ts/u);
      expect(existsSync(lock)).toBe(false);

      // Restored to HEAD, a sweep runs again and observes exactly its own mutant.
      writeFileSync(join(root, 'src/a.ts'), A);
      const rerun = startDriver(root, control, 'R', ['M5']);
      expect((await rerun.exited).code).toBe(0);
      expect(
        log(control, 'R').find((entry) => entry.point === 'mutant:M5' && entry.event === 'observed')
          ?.content,
      ).toBe(M5_APPLIED);
    },
    CHILD_TIMEOUT_MS,
  );
});

const PASSED: Classification = {
  outcome: 'SURVIVED',
  detail: 'passed',
  matched: 1,
  unrelatedFailures: 0,
};
const KILLED: Classification = {
  outcome: 'KILLED_ASSERTION',
  detail: 'killed',
  matched: 1,
  unrelatedFailures: 0,
};

describe('one ownership lifecycle', () => {
  evidenceTest(
    'takes the lock before HEAD or any source is read, and never overwrites one',
    async () => {
      // Another holder's lock, a dirty tree: the refusal must be the lock's, because the lock comes
      // first. A sweep that checked the source first would report the tree instead.
      const root = repository();
      writeFileSync(join(root, 'src/a.ts'), M1_APPLIED);
      const lock = sweepLockPath(root);
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), '{"pid": 1, "token": "someone else"}');
      const calls: string[] = [];

      const sweep = runSweep(MANIFEST, [M5], {
        root,
        observe: (variant, phase) => {
          calls.push(`${phase}:${variant.id}`);
          return Promise.resolve({ classification: PASSED, durationMs: 0 });
        },
      });
      await expect(sweep).rejects.toBeInstanceOf(SweepLockError);
      await expect(sweep).rejects.not.toBeInstanceOf(SourceIntegrityError);
      expect(calls).toStrictEqual([]);
      expect(readFileSync(join(lock, 'owner.json'), 'utf8')).toBe(
        '{"pid": 1, "token": "someone else"}',
      );
    },
  );

  it('holds the lock through every run and the report, and releases it after', async () => {
    const root = repository();
    const lock = sweepLockPath(root);
    const held: boolean[] = [];
    const observe: Observe = (_variant, phase) => {
      held.push(existsSync(lock));
      return Promise.resolve({
        classification: phase === 'baseline' ? PASSED : KILLED,
        durationMs: 0,
      });
    };
    let reportedUnderLock = false;
    await runSweep(MANIFEST, [M1, M5], {
      root,
      observe,
      onComplete: () => {
        // The last restore is verified and the tree is pristine before the report is written,
        // and the lock is still held while it is.
        reportedUnderLock = existsSync(lock) && readFileSync(join(root, 'src/a.ts'), 'utf8') === A;
      },
    });
    expect(held).toStrictEqual([true, true, true]);
    expect(reportedUnderLock).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('restores, verifies and releases when the observer throws, as a reporter failure would', async () => {
    const root = repository();
    const observe: Observe = (_variant, phase) =>
      phase === 'baseline'
        ? Promise.resolve({ classification: PASSED, durationMs: 0 })
        : Promise.reject(new Error('the reporter wrote nothing'));
    await expect(runSweep(MANIFEST, [M1], { root, observe })).rejects.toThrow(
      /reporter wrote nothing/u,
    );
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
    expect(existsSync(sweepLockPath(root))).toBe(false);
  });

  it('releases after a failed baseline and after a refused tree', async () => {
    const root = repository();
    const failing: Classification = {
      outcome: 'INFRA_FAILURE',
      detail: 'no database',
      matched: 0,
      unrelatedFailures: 0,
    };
    const results = await runSweep(MANIFEST, [M1], {
      root,
      observe: () => Promise.resolve({ classification: failing, durationMs: 0 }),
    });
    expect(results.map((result) => result.outcome)).toStrictEqual(['BASELINE_FAILED']);
    expect(existsSync(sweepLockPath(root))).toBe(false);

    writeFileSync(join(root, 'src/b.ts'), 'export const other = 1;\n');
    await expect(
      runSweep(MANIFEST, [M1], { root, observe: () => Promise.reject(new Error('unreachable')) }),
    ).rejects.toBeInstanceOf(SourceIntegrityError);
    expect(existsSync(sweepLockPath(root))).toBe(false);
  });

  it('refuses and releases when the owner record cannot be written', async () => {
    const root = repository();
    const calls: string[] = [];
    const write: WriteFile = (path, data) => {
      if (path.endsWith('owner.json')) throw new Error('read-only file system');
      writeFileSync(path, data);
    };
    await expect(
      runSweep(MANIFEST, [M1], {
        root,
        write,
        observe: (variant, phase) => {
          calls.push(`${phase}:${variant.id}`);
          return Promise.resolve({ classification: PASSED, durationMs: 0 });
        },
      }),
    ).rejects.toThrow(/could not record ownership .*read-only file system/u);
    expect(calls).toStrictEqual([]);
    expect(existsSync(sweepLockPath(root))).toBe(false);
  });

  it('releases idempotently, and never removes a lock it no longer owns', () => {
    const root = repository();
    const first = acquireSweepLock(root);
    first.record('head');
    expect(() => acquireSweepLock(root)).toThrow(SweepLockError);
    first.release();
    first.release();
    expect(existsSync(sweepLockPath(root))).toBe(false);

    // Removed by hand while held, and taken by another sweep: the first must leave it alone.
    const stale = acquireSweepLock(root);
    stale.record('head');
    rmSync(sweepLockPath(root), { recursive: true });
    const current = acquireSweepLock(root);
    current.record('head');
    stale.release();
    expect(existsSync(sweepLockPath(root))).toBe(true);
    current.release();
    expect(existsSync(sweepLockPath(root))).toBe(false);
  });
});

describe('the fixture itself', () => {
  it('builds the review pair so that each anchor resolves once in the pristine file', () => {
    expect(applyMutation(A, M1.find, M1.replace)).toStrictEqual({ ok: true, source: M1_APPLIED });
    expect(applyMutation(A, M5.find, M5.replace)).toStrictEqual({ ok: true, source: M5_APPLIED });
    expect(M1.killingTest).toStrictEqual(M5.killingTest);
  });
});
