/**
 * Exactly one mutant against the HEAD tree, even after a sweep was killed (P06.10.07).
 *
 * A sweep mutates in place and restores in a `finally`. `SIGKILL` skips the `finally`, and the next
 * sweep used to read the still-mutated file as its "original": a stale M1 and a fresh M2 whose
 * anchor still resolved then coexisted, and M2 was baselined against a contaminated tree. These
 * tests build a throwaway Git repository per case, leave real stale mutants in it, and run the
 * production sweep — as a new process where the claim is about a new process — with a fake
 * observer standing in for Vitest, so that "no baseline ran" is something that can be counted.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Classification } from './mutation-outcome.ts';
import {
  applyMutation,
  capturePristine,
  resolveHead,
  restorePristine,
  runSweep,
  SOURCE_INTEGRITY_EXIT,
  SourceIntegrityError,
  type Observe,
  type Result,
  type Variant,
  type WriteFile,
} from './mutation-sweep.ts';
import { evidenceTest } from '@moin/testing';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = join(REPO, 'scripts', 'mutation-sweep.ts');
const DRIVER = join(REPO, 'scripts', '__fixtures__', 'sweep', 'signal-driver.ts');
const CHILD_TIMEOUT_MS = 30_000;
const POLL_MS = 25;

/** Nothing from an enclosing Git hook may point these repositories somewhere else. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

const A = 'export const a = 1;\nexport const b = 2;\n';
const B = 'export const c = 3;\n';

function variant(id: string, file: string, find: string, replace: string): Variant {
  return {
    id,
    invariant: `test invariant for ${id}`,
    expected: 'a test fixture',
    file,
    find,
    replace,
    killingTest: { file: 'shared.test.ts', fullName: 'one shared killing test' },
    project: 'unit',
  };
}

const M1 = variant('M1', 'src/a.ts', 'export const a = 1;', 'export const a = 9;');
const M2 = variant('M2', 'src/a.ts', 'export const b = 2;', 'export const b = 9;');
const M3 = variant('M3', 'src/b.ts', 'export const c = 3;', 'export const c = 9;');
const MANIFEST = [M1, M2, M3];

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
}

function commitAll(root: string, message: string): void {
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
    message,
  ]);
}

/** A fresh repository whose HEAD holds `files`, plus the manifest written beside it. */
function repository(files: Record<string, string> = { 'src/a.ts': A, 'src/b.ts': B }): string {
  const root = mkdtempSync(join(tmpdir(), 'moin-sweep-'));
  roots.push(root);
  git(root, ['init', '-q']);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  commitAll(root, 'pristine');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(MANIFEST));
  return root;
}

/** What a sweep killed by SIGKILL leaves behind: the mutant, and no restore. */
function leaveStaleMutant(root: string, stale: Variant): string {
  const path = join(root, stale.file);
  const applied = applyMutation(readFileSync(path, 'utf8'), stale.find, stale.replace);
  if (!applied.ok) throw new Error(`fixture: ${stale.id} did not apply`);
  writeFileSync(path, applied.source);
  return applied.source;
}

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

/** Stands in for Vitest and records every run it was asked for. */
function observer(calls: string[], duringMutant?: (variant: Variant) => void): Observe {
  return (variant, phase) => {
    calls.push(`${phase}:${variant.id}`);
    if (phase === 'mutant') duringMutant?.(variant);
    return Promise.resolve({
      classification: phase === 'baseline' ? PASSED : KILLED,
      durationMs: 0,
    });
  };
}

/** The sweep's own CLI, as a new process: nothing in memory survives from the killed one. */
function sweepProcess(
  root: string,
  only: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [SWEEP, '--root', root, '--manifest', join(root, 'manifest.json'), '--only', only],
    { cwd: REPO, env: ENV, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('a sweep restarted after one was killed mid-mutant', () => {
  evidenceTest(
    'refuses in a new process, though the stale M1 is valid and M2 still applies once',
    () => {
      const root = repository();
      const stale = leaveStaleMutant(root, M1);
      // The dangerous case, established rather than assumed: the stale tree is ordinary source and
      // M2's anchor resolves exactly once in it, so nothing about M2 itself looks wrong.
      expect(applyMutation(stale, M2.find, M2.replace).ok).toBe(true);

      const result = sweepProcess(root, 'M2');

      expect(result.status).toBe(SOURCE_INTEGRITY_EXIT);
      expect(result.stderr).toMatch(
        /mutation target is not pristine at expected HEAD [0-9a-f]{40}: src\/a\.ts/u,
      );
      expect(result.stderr).toMatch(/Sweep refused to run/u);
      // No variant line was printed, so no variant reached an outcome.
      expect(result.stdout).not.toMatch(/KILLED|SURVIVED|BASELINE|INVALID/u);
      // M2 was not applied, and M1 was not "repaired": the tree is exactly as the killed sweep left it.
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(stale);
    },
  );

  evidenceTest('runs no baseline and applies nothing', async () => {
    const root = repository();
    const stale = leaveStaleMutant(root, M1);
    const calls: string[] = [];

    await expect(runSweep(MANIFEST, [M2], { root, observe: observer(calls) })).rejects.toThrow(
      /not pristine at expected HEAD .*src\/a\.ts/u,
    );
    expect(calls).toStrictEqual([]);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(stale);
  });
});

describe('a stale mutant in another file', () => {
  evidenceTest('stops a variant whose own target is pristine', async () => {
    // M1 is left in a.ts; M3 targets b.ts, which is untouched. A test of b.ts can still observe a.ts,
    // so checking only the current target would measure M3 against a contaminated tree.
    const root = repository();
    leaveStaleMutant(root, M1);
    const calls: string[] = [];

    await expect(runSweep(MANIFEST, [M3], { root, observe: observer(calls) })).rejects.toThrow(
      /not pristine at expected HEAD .*src\/a\.ts/u,
    );
    expect(calls).toStrictEqual([]);
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe(B);
  });

  it('stops the CLI too', () => {
    const root = repository();
    leaveStaleMutant(root, M1);
    const result = sweepProcess(root, 'M3');
    expect(result.status).toBe(SOURCE_INTEGRITY_EXIT);
    expect(result.stderr).toMatch(/src\/a\.ts/u);
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe(B);
  });
});

describe('the baseline cache', () => {
  evidenceTest(
    'is never consulted for a tree that changed after the baseline was measured',
    async () => {
      // M1 and M2 share a killing test, so M2 would reuse M1's cached baseline. Something writes to
      // b.ts while M1's mutant runs; the check after M1 must stop M2 before the cache is reached.
      const root = repository();
      const calls: string[] = [];
      const results: Result[] = [];
      const contaminate = (): void => {
        writeFileSync(join(root, 'src/b.ts'), 'export const c = 4;\n');
      };

      await expect(
        runSweep(MANIFEST, [M1, M2], {
          root,
          observe: observer(calls, contaminate),
          onResult: (result) => results.push(result),
        }),
      ).rejects.toThrow(/not pristine at expected HEAD .*src\/b\.ts/u);
      expect(calls).toStrictEqual(['baseline:M1', 'mutant:M1']);
      expect(results.map((result) => result.variant.id)).toStrictEqual([]);
    },
  );

  it('is keyed on, and stops at, a HEAD that moved during the sweep', async () => {
    const root = repository({ 'src/a.ts': A, 'src/b.ts': B, 'other.txt': 'x\n' });
    const calls: string[] = [];
    const moveHead = (): void => {
      writeFileSync(join(root, 'other.txt'), 'y\n');
      git(root, ['add', 'other.txt']);
      git(root, [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-q',
        '--no-verify',
        '-m',
        'moved',
      ]);
    };
    await expect(
      runSweep(MANIFEST, [M1, M2], { root, observe: observer(calls, moveHead) }),
    ).rejects.toThrow(/HEAD moved from [0-9a-f]{40} to [0-9a-f]{40} after M1/u);
    expect(calls).toStrictEqual(['baseline:M1', 'mutant:M1']);
  });
});

describe('restoring a target after its mutant', () => {
  evidenceTest(
    'aborts the sweep when the restored file is one byte off, before the next variant',
    async () => {
      const root = repository();
      const calls: string[] = [];
      // Writes mutants faithfully and corrupts the restore: the pristine bytes arrive as a Buffer.
      const corruptingRestore: WriteFile = (path, data) => {
        if (typeof data === 'string') {
          writeFileSync(path, data);
          return;
        }
        const corrupted = Buffer.from(data);
        corrupted[0] = (corrupted[0] ?? 0) ^ 1;
        writeFileSync(path, corrupted);
      };

      const sweep = runSweep(MANIFEST, [M1, M3], {
        root,
        observe: observer(calls),
        write: corruptingRestore,
      });
      // The restore's own verification fires — not the later all-target check — so the failure
      // names the restore.
      await expect(sweep).rejects.toThrow(
        /restoring src\/a\.ts did not reproduce its pristine bytes/u,
      );
      await expect(sweep).rejects.toBeInstanceOf(SourceIntegrityError);
      expect(calls).toStrictEqual(['baseline:M1', 'mutant:M1']);

      // The file is left as it is for a human, and the next sweep refuses to start on it.
      const next: string[] = [];
      await expect(runSweep(MANIFEST, [M3], { root, observe: observer(next) })).rejects.toThrow(
        /not pristine/u,
      );
      expect(next).toStrictEqual([]);
    },
  );

  it('aborts when the restore itself throws', async () => {
    const root = repository();
    const calls: string[] = [];
    const failingRestore: WriteFile = (path, data) => {
      if (typeof data !== 'string') throw new Error('disk full');
      writeFileSync(path, data);
    };
    await expect(
      runSweep(MANIFEST, [M1, M3], { root, observe: observer(calls), write: failingRestore }),
    ).rejects.toThrow(/restoring src\/a\.ts failed \(disk full\)/u);
    expect(calls).toStrictEqual(['baseline:M1', 'mutant:M1']);
  });

  it('puts back the exact HEAD bytes and runs every variant when nothing goes wrong', async () => {
    const root = repository();
    const calls: string[] = [];
    const seen: string[] = [];
    const results = await runSweep(MANIFEST, MANIFEST, {
      root,
      observe: observer(calls, (mutated) => {
        seen.push(readFileSync(join(root, mutated.file), 'utf8'));
      }),
    });
    expect(results.map((result) => result.outcome)).toStrictEqual([
      'KILLED_ASSERTION',
      'KILLED_ASSERTION',
      'KILLED_ASSERTION',
    ]);
    // One cached baseline per tree and test, after the checks.
    expect(calls).toStrictEqual(['baseline:M1', 'mutant:M1', 'mutant:M2', 'mutant:M3']);
    // Each mutant ran alone: exactly its own edit on top of the HEAD bytes.
    expect(seen).toStrictEqual([
      'export const a = 9;\nexport const b = 2;\n',
      'export const a = 1;\nexport const b = 9;\n',
      'export const c = 9;\n',
    ]);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe(B);
  });
});

describe('what counts as pristine', () => {
  evidenceTest('is the HEAD blob, not whatever the working tree holds', () => {
    const root = repository();
    const head = resolveHead(root);
    expect(capturePristine(root, head, 'src/a.ts').toString('utf8')).toBe(A);
    leaveStaleMutant(root, M2);
    expect(() => capturePristine(root, head, 'src/a.ts')).toThrow(
      /not pristine at expected HEAD .*src\/a\.ts/u,
    );
  });

  it("applies the path's line-ending filter, as Git does", () => {
    // Stored with LF, checked out with CRLF. A raw byte comparison with `git show HEAD:path` would
    // call this dirty; hashing with `--path` gives the blob Git itself would store.
    const crlf = 'export const a = 1;\r\nexport const b = 2;\r\n';
    const root = repository({
      '.gitattributes': 'src/a.ts text eol=crlf\n',
      'src/a.ts': crlf,
      'src/b.ts': B,
    });
    expect(git(root, ['show', 'HEAD:src/a.ts'])).not.toContain('\r');
    const head = resolveHead(root);
    const pristine = capturePristine(root, head, 'src/a.ts');
    expect(pristine.toString('utf8')).toBe(crlf);
    // And the restore writes those CRLF bytes back and still verifies against the LF blob.
    writeFileSync(join(root, 'src/a.ts'), 'changed\r\n');
    restorePristine(root, head, 'src/a.ts', pristine);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(crlf);
  });

  it('refuses an untracked target, a path outside the repository, and a symlink', () => {
    const root = repository();
    const head = resolveHead(root);
    writeFileSync(join(root, 'src/untracked.ts'), 'x\n');
    expect(() => capturePristine(root, head, 'src/untracked.ts')).toThrow(
      /not a file tracked at HEAD/u,
    );
    expect(() => capturePristine(root, head, '../outside.ts')).toThrow(
      /not a plain repository-relative path/u,
    );
    expect(() => capturePristine(root, head, `${root}/src/a.ts`)).toThrow(
      /not a plain repository-relative path/u,
    );
    symlinkSync('a.ts', join(root, 'src/link.ts'));
    commitAll(root, 'link');
    expect(() => capturePristine(root, resolveHead(root), 'src/link.ts')).toThrow(/mode 120000/u);
  });

  it('refuses a repository without a HEAD', () => {
    const root = mkdtempSync(join(tmpdir(), 'moin-sweep-'));
    roots.push(root);
    git(root, ['init', '-q']);
    expect(() => resolveHead(root)).toThrow(/cannot resolve HEAD/u);
  });
});

describe('a signal during the mutant window', () => {
  async function interrupt(
    signal: 'SIGINT' | 'SIGTERM',
  ): Promise<{ code: number | null; stderr: string; root: string }> {
    const root = repository();
    const marker = join(root, 'mutant-applied');
    const child = spawn(process.execPath, [DRIVER, root, marker, JSON.stringify(MANIFEST)], {
      cwd: REPO,
      env: ENV,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const exited = new Promise<number | null>((settle) => {
      child.on('exit', (code) => {
        settle(code);
      });
    });
    const deadline = Date.now() + CHILD_TIMEOUT_MS;
    while (!existsSync(marker)) {
      if (Date.now() > deadline || child.exitCode !== null) {
        child.kill('SIGKILL');
        throw new Error(`the driver never reached its mutant window: ${stderr}`);
      }
      await new Promise((settle) => setTimeout(settle, POLL_MS));
    }
    // The mutant really is on disk at the moment the signal arrives.
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toContain('export const a = 9;');
    child.kill(signal);
    return { code: await exited, stderr, root };
  }

  it(
    'SIGTERM restores and verifies the target, then exits 143',
    async () => {
      const { code, stderr, root } = await interrupt('SIGTERM');
      expect(code).toBe(143);
      expect(stderr).toMatch(/SIGTERM: restored src\/a\.ts to its HEAD bytes and verified it/u);
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'SIGINT restores and verifies the target, then exits 130',
    async () => {
      const { code, stderr, root } = await interrupt('SIGINT');
      expect(code).toBe(130);
      expect(stderr).toMatch(/SIGINT: restored src\/a\.ts/u);
      expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
    },
    CHILD_TIMEOUT_MS,
  );
});
