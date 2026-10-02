/**
 * The mutation sweep (QG-09 negative controls, P06.10.07).
 *
 * ## Why this exists as a committed tool rather than a one-off script
 *
 * A test that has never been made to fail is a hope, not a control. Every guard in the audit
 * subsystem therefore has at least one *defective variant*: a named, minimal edit that would
 * reintroduce the defect the guard exists to prevent. The manifest is data
 * (`docs/verification/audit-mutation-manifest.json`) so the set is *inspectable*: each entry names
 * the invariant it targets, what failure is expected, and which test kills it. A total count alone
 * tells a reviewer nothing about coverage.
 *
 * ## Two rules that make the count mean something
 *
 * 1. **A baseline first.** The named test is run against the pristine tree and must actually run
 *    and pass. Without that, a variant "killed" by a test that was already failing is no evidence
 *    at all, and the report would launder a broken suite into a perfect score.
 * 2. **The outcome comes from the structured report, not the exit code.** The previous version
 *    counted any non-zero exit as a kill — so an unreachable database reported every variant killed,
 *    and a manifest entry naming a nonexistent test reported it survived. `mutation-outcome.ts`
 *    makes that decision over Vitest's JSON report and distinguishes an assertion rejecting the
 *    mutation from a timeout, a transform error, a setup failure or an unrelated failure.
 *
 * ## A third rule: exactly one mutant against the HEAD tree
 *
 * A sweep mutates files in place and restores them in a `finally`. `SIGKILL`, a crash or a lost
 * machine skip the `finally`, and the next sweep used to read the still-mutated file as its
 * "original" — so a stale mutant M1 and a fresh M2 whose anchor still resolved coexisted, and M2 was
 * baselined and measured against a contaminated tree. So the working tree is never trusted:
 *
 *  - **before anything runs**, every mutation target named anywhere in the manifest — not only the
 *    selected variants', since a stale mutant in file A changes what a test of file B observes — is
 *    hashed the way Git would store it (`git hash-object --path`, so the path's line-ending and
 *    clean filters apply) and compared with its blob at the sweep's HEAD. Any difference aborts the
 *    whole sweep. It is not repaired: whether the difference is a stale mutant or someone's work is
 *    not this tool's to guess;
 *  - **per variant**, the bytes restored afterwards are the bytes that were proved equal to HEAD,
 *    captured in the same step that proved it; after restoring, the file is re-read and must equal
 *    them and hash to the HEAD blob, and every target is checked again. A failure aborts the sweep
 *    and the next variant never runs;
 *  - the baseline cache is consulted only after those checks, and is keyed on the same HEAD.
 *
 * `SIGINT` and `SIGTERM` restore and verify the active target before exiting. `SIGKILL` cannot be
 * handled by anything; what protects against it is that the next invocation refuses to start.
 *
 * ## A fourth rule: one sweep per worktree
 *
 * Two sweeps in one worktree both passed the pristine check, then took turns writing the same file:
 * A's test ran against B's mutant, B's baseline ran against A's, and both reported a kill. Every
 * per-variant check passed, because each sweep restored what it had written. So a sweep takes an
 * exclusive lock **before it reads anything** — before HEAD, the pristine check, the baseline cache
 * or a baseline — and holds it until the last restore is verified and the report is written.
 *
 * The lock is a directory created with `mkdir`, which either creates it or fails with `EEXIST`:
 * there is no check-then-create window. It lives in the worktree's own Git directory
 * (`git rev-parse --absolute-git-dir`), so linked worktrees sweep independently. An existing lock is
 * never removed or overwritten by a sweep, however old it looks: `SIGKILL` can leave one behind,
 * and refusing to start is the safe reading of it. Recovery is manual — see
 * `docs/verification/README.md`.
 *
 * A variant that SURVIVES is not a code defect — it means the test is weaker than it looks, or the
 * guard it removes is redundant with another. Both have happened here, and both are worth knowing.
 *
 *   node scripts/mutation-sweep.ts --validate     # anchors resolve; changes nothing, runs nothing
 *   node scripts/mutation-sweep.ts                # baseline + mutant for every variant
 *   node scripts/mutation-sweep.ts --only B4-1-…  # one variant
 *   node scripts/mutation-sweep.ts --report docs/verification/audit-mutation-report.md
 *   node scripts/mutation-sweep.ts --json out.json
 *   node scripts/mutation-sweep.ts --root <repo> --manifest <file>   # sweep another checkout
 *
 * Exit codes: 0 every variant is evidence, 1 some variant is not, 2 a usage or manifest error,
 * 3 the source tree could not be shown to be the HEAD tree — nothing was, or will be, measured,
 * 4 another sweep holds this worktree's lock — nothing was read or measured.
 */

import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  baselineIsUsable,
  classifyRun,
  type Classification,
  type KillingTest,
  type MutationOutcome,
  type MutationReport,
} from './mutation-outcome.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'docs', 'verification', 'audit-mutation-manifest.json');

const TEST_TIMEOUT_MS = 1_200_000;

/** Turns a full test name into a literal regular expression. */
function escapeForFilter(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The outcome of trying to inject one variant into a source file. */
export type MutationApplication =
  { readonly ok: true; readonly source: string } | { readonly ok: false; readonly reason: string };

/**
 * Inject one variant, or refuse.
 *
 * Two rules, both enforced **here** rather than only in `--validate`, because an operator who
 * skips validation must not get a weaker guarantee than one who does not:
 *
 *  1. the anchor must occur **exactly once**. A two-place anchor used to mutate whichever occurred
 *     first, so which guard a variant attacked was decided by file order — one manifest entry was
 *     in that state and was only correct by luck;
 *  2. the replacement must differ from the anchor, or the "mutant" is the pristine tree and any
 *     kill it reports is meaningless.
 *
 * The splice is positional rather than `String.prototype.replace`, which interprets its
 * replacement: `$$` means a literal `$`, so every variant whose replacement contained a SQL
 * function body was silently corrupted into `AS $` and the migration failed with a syntax error.
 * The variant looked detected; nothing had been tested. A positional splice interprets nothing.
 */
export function applyMutation(source: string, find: string, replace: string): MutationApplication {
  if (find.length === 0) {
    return { ok: false, reason: 'the anchor is empty, so it does not identify a place to mutate' };
  }
  if (replace === find) {
    return {
      ok: false,
      reason: 'the replacement is identical to the anchor, so the mutant is the pristine tree',
    };
  }
  const occurrences = source.split(find).length - 1;
  if (occurrences === 0) {
    return { ok: false, reason: 'the anchor is not present' };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      reason: `the anchor occurs ${String(occurrences)} times, so which one is mutated is arbitrary`,
    };
  }
  const index = source.indexOf(find);
  return { ok: true, source: source.slice(0, index) + replace + source.slice(index + find.length) };
}

/** Exit code when the tree cannot be shown to be the HEAD tree. Nothing is measured. */
export const SOURCE_INTEGRITY_EXIT = 3;

/** Git file modes a mutation target may have: an ordinary file, executable or not. */
const REGULAR_FILE_MODES = new Set(['100644', '100755']);

/**
 * The sweep cannot prove it is measuring exactly one mutant against the HEAD tree.
 *
 * Never caught inside the sweep: it propagates to `main`, which reports it and exits with
 * `SOURCE_INTEGRITY_EXIT`. A sweep that continued past one would measure an unknown tree.
 */
export class SourceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceIntegrityError';
  }
}

/**
 * The environment Git runs in: the caller's, minus every `GIT_*` variable. A sweep started from a
 * Git hook inherits `GIT_DIR` and `GIT_INDEX_FILE`, which would silently point these checks at
 * another repository than `root`.
 */
function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}

function git(root: string, args: readonly string[], input?: Buffer): string {
  return execFileSync('git', args, {
    cwd: root,
    env: gitEnvironment(),
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(input === undefined ? {} : { input }),
  }).trim();
}

/**
 * A restore that could not be verified. The target may still hold a mutant, so the sweep keeps its
 * worktree lock rather than releasing it: a human looks before anything sweeps here again.
 */
export class RestoreFailedError extends SourceIntegrityError {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreFailedError';
  }
}

/** The commit the sweep measures against. No Git, no sweep: there is nothing to compare with. */
export function resolveHead(root: string): string {
  try {
    return git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  } catch {
    throw new SourceIntegrityError(
      `cannot resolve HEAD in ${root}, so no mutation target can be shown to be pristine; sweep refused to run`,
    );
  }
}

/** A manifest path, refused unless it is a plain repository-relative path. */
function targetPath(root: string, file: string): string {
  const normalised = normalize(file);
  if (
    file.length === 0 ||
    isAbsolute(file) ||
    file.includes('\\') ||
    normalised !== file ||
    normalised.split(sep).includes('..')
  ) {
    throw new SourceIntegrityError(
      `mutation target ${JSON.stringify(file)} is not a plain repository-relative path; sweep refused to run`,
    );
  }
  return join(root, file);
}

/** The blob id `file` has in commit `head`, or a refusal when it is not a tracked regular file. */
function headBlob(root: string, head: string, file: string): string {
  let listed: string;
  try {
    listed = git(root, ['ls-tree', '-z', '--full-tree', head, '--', file]);
  } catch {
    listed = '';
  }
  const entries = listed.split('\0').filter((entry) => entry.length > 0);
  const [entry] = entries;
  const match = entry === undefined ? null : /^(\d+) blob ([0-9a-f]+)\t(.*)$/su.exec(entry);
  if (entries.length !== 1 || match?.[3] !== file) {
    throw new SourceIntegrityError(
      `mutation target ${file} is not a file tracked at HEAD ${head}; sweep refused to run`,
    );
  }
  const [, mode = '', oid = ''] = match;
  if (!REGULAR_FILE_MODES.has(mode)) {
    throw new SourceIntegrityError(
      `mutation target ${file} has mode ${mode} at HEAD ${head}, not a regular file; sweep refused to run`,
    );
  }
  return oid;
}

/**
 * The blob id Git would store for these bytes at this path.
 *
 * `--path` applies the path's attributes — line-ending conversion and clean filters — exactly as
 * `git add` would, so a checkout with `eol=crlf` is pristine when its blob is, and a raw byte
 * comparison with `git show HEAD:path` would have called it dirty.
 */
function blobOf(root: string, file: string, bytes: Buffer): string {
  return git(root, ['hash-object', `--path=${file}`, '--stdin'], bytes);
}

/**
 * The bytes of `file`, proved to be the HEAD tree's, or a refusal.
 *
 * Read once, and the proof is over exactly the bytes returned: there is no second read for the
 * file to change in between. This is the only definition of "original" the sweep has.
 */
export function capturePristine(root: string, head: string, file: string): Buffer {
  const path = targetPath(root, file);
  const expected = headBlob(root, head, file);
  let bytes: Buffer;
  try {
    if (!lstatSync(path).isFile()) throw new Error('not a regular file');
    bytes = readFileSync(path);
  } catch {
    throw new SourceIntegrityError(
      `mutation target ${file} is missing or not a regular file in the working tree; sweep refused to run`,
    );
  }
  const actual = blobOf(root, file, bytes);
  if (actual !== expected) {
    throw new SourceIntegrityError(
      `mutation target is not pristine at expected HEAD ${head}: ${file} hashes to ${actual}, HEAD has ${expected}. ` +
        'It may be a mutant a killed sweep left behind, or uncommitted work; it was not changed. ' +
        'Sweep refused to run.',
    );
  }
  return bytes;
}

/** Every target, against HEAD, and HEAD itself against the sweep's. */
export function assertTargetsPristine(
  root: string,
  head: string,
  files: readonly string[],
  when: string,
): void {
  const current = resolveHead(root);
  if (current !== head) {
    throw new SourceIntegrityError(
      `HEAD moved from ${head} to ${current} ${when}, so the baselines describe another tree; sweep aborted`,
    );
  }
  for (const file of new Set(files)) capturePristine(root, head, file);
}

/** How a file is written. Injected only by the harness's own tests, to simulate a failed restore. */
export type WriteFile = (path: string, data: string | Buffer) => void;

/**
 * Put the proved bytes back, then prove it worked: the file must read back as exactly those bytes
 * and hash to the HEAD blob. Anything else aborts the sweep.
 */
export function restorePristine(
  root: string,
  head: string,
  file: string,
  pristine: Buffer,
  write: WriteFile = writeFileSync,
): void {
  const path = targetPath(root, file);
  try {
    write(path, pristine);
  } catch (error) {
    throw new RestoreFailedError(
      `restoring ${file} failed (${error instanceof Error ? error.message : String(error)}); ` +
        `it may still hold a mutant. Sweep aborted; compare it with HEAD ${head} before sweeping again`,
    );
  }
  const restored = readFileSync(path);
  if (!restored.equals(pristine) || blobOf(root, file, restored) !== headBlob(root, head, file)) {
    throw new RestoreFailedError(
      `restoring ${file} did not reproduce its pristine bytes; it may still hold a mutant. ` +
        `Sweep aborted; compare it with HEAD ${head} before sweeping again`,
    );
  }
}

/** Exit code when another sweep holds this worktree's lock. Nothing was read or measured. */
export const SWEEP_LOCK_EXIT = 4;

const LOCK_DIRECTORY = 'moin-mutation-sweep.lock';
const LOCK_OWNER_FILE = 'owner.json';

/** This worktree's sweep lock is held, or could not be taken. Nothing was read or measured. */
export class SweepLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SweepLockError';
  }
}

/**
 * Where the sweep lock for the worktree containing `root` lives.
 *
 * `--absolute-git-dir` is the worktree's **own** Git directory — `.git` for the main worktree,
 * `.git/worktrees/<name>` for a linked one — so two worktrees never share a lock, and a source file
 * is never the lock.
 */
export function sweepLockPath(root: string): string {
  let gitDirectory: string;
  try {
    gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
  } catch {
    throw new SweepLockError(
      `cannot resolve the Git directory of ${root}, so no worktree lock can be taken; sweep refused to run`,
    );
  }
  return join(gitDirectory, LOCK_DIRECTORY);
}

/** Who holds the lock, as far as its owner record says. Informational only; never trusted. */
function describeHolder(path: string): string {
  let owner: unknown;
  try {
    owner = JSON.parse(readFileSync(join(path, LOCK_OWNER_FILE), 'utf8'));
  } catch {
    return 'it has no readable owner record — its holder may have died before writing one';
  }
  if (typeof owner !== 'object' || owner === null) return 'its owner record is malformed';
  const field = (name: string): string => {
    const value = (owner as Record<string, unknown>)[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '?';
  };
  const retained = (owner as Record<string, unknown>)['retained'];
  return (
    `held by pid ${field('pid')} on ${field('hostname')}, started ${field('startedAt')} at HEAD ` +
    `${field('head')}, cwd ${field('cwd')}` +
    (typeof retained === 'string' ? `; kept after a failed restore: ${retained}` : '')
  );
}

/** The refusal an operator reads. Recovery is spelled out, because the sweep will not do it. */
function lockHeldMessage(path: string): string {
  return (
    `mutation sweep lock already held for this worktree: ${path} (${describeHolder(path)}). ` +
    'Sweep refused to run; nothing was read or measured. If no sweep is running — check the pid, ' +
    'on that host — restore any target that still differs from HEAD, remove the lock directory, ' +
    'and run again.'
  );
}

/** The holder description when this worktree's lock exists, otherwise undefined. Read only. */
export function sweepLockHolder(root: string): string | undefined {
  const path = sweepLockPath(root);
  return existsSync(path) ? lockHeldMessage(path) : undefined;
}

/** Exclusive ownership of one worktree's sweep lock. */
export interface SweepLock {
  readonly path: string;
  /** Write the informational owner record. Failure is a `SweepLockError`; the caller releases. */
  record: (head: string) => void;
  /** Keep the lock after a failed restore, so the next sweep refuses until a human has looked. */
  retain: (reason: string) => void;
  /** Idempotent. Removes only a lock this process created and still owns. */
  release: () => void;
}

/** The lock this process holds, for the signal handlers. */
let activeLock: SweepLock | undefined;

/**
 * Take this worktree's lock, or refuse.
 *
 * `mkdir` without `recursive` is the whole primitive: it creates the directory or fails with
 * `EEXIST`, atomically, so two sweeps cannot both succeed. Nothing is checked first.
 */
export function acquireSweepLock(root: string, write: WriteFile = writeFileSync): SweepLock {
  const path = sweepLockPath(root);
  try {
    mkdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SweepLockError(lockHeldMessage(path));
    }
    throw new SweepLockError(
      `cannot create the sweep lock ${path} (${error instanceof Error ? error.message : String(error)}); sweep refused to run`,
    );
  }

  const ownerPath = join(path, LOCK_OWNER_FILE);
  const owner = {
    pid: process.pid,
    hostname: hostname(),
    cwd: process.cwd(),
    root,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };
  let state: 'held' | 'retained' | 'released' = 'held';
  let recorded = false;

  function stillOurs(): boolean {
    try {
      const current = JSON.parse(readFileSync(ownerPath, 'utf8')) as { token?: unknown };
      return current.token === owner.token;
    } catch {
      return false;
    }
  }

  const lock: SweepLock = {
    path,
    record(head) {
      try {
        write(ownerPath, `${JSON.stringify({ ...owner, head }, null, 2)}\n`);
      } catch (error) {
        throw new SweepLockError(
          `could not record ownership of the sweep lock ${path} (${error instanceof Error ? error.message : String(error)}); ` +
            'the lock is released and nothing was measured',
        );
      }
      recorded = true;
    },
    retain(reason) {
      if (state !== 'held') return;
      state = 'retained';
      if (activeLock === lock) activeLock = undefined;
      try {
        write(ownerPath, `${JSON.stringify({ ...owner, retained: reason }, null, 2)}\n`);
      } catch {
        // The lock directory itself is what keeps the next sweep out; the record is diagnostics.
      }
    },
    release() {
      if (state !== 'held') return;
      state = 'released';
      if (activeLock === lock) activeLock = undefined;
      // A lock removed by hand and re-taken by another sweep is not ours to remove.
      if (recorded && !stillOurs()) {
        console.error(`the sweep lock ${path} no longer names this process; left in place`);
        return;
      }
      try {
        rmSync(ownerPath, { force: true });
        rmdirSync(path);
      } catch (error) {
        console.error(
          `could not remove the sweep lock ${path} (${error instanceof Error ? error.message : String(error)}); remove it by hand`,
        );
      }
    },
  };
  activeLock = lock;
  return lock;
}

/** The one target that may currently hold a mutant, for the signal handlers. */
let activeMutation:
  | {
      readonly root: string;
      readonly head: string;
      readonly file: string;
      readonly pristine: Buffer;
    }
  | undefined;
const activeChildren = new Set<ChildProcess>();

const SIGNAL_EXIT: Readonly<Record<'SIGINT' | 'SIGTERM', number>> = { SIGINT: 130, SIGTERM: 143 };

/**
 * Best effort for the signals that can be caught: stop the test run, restore and verify the active
 * target, release the lock only once that has succeeded, then exit with the conventional code.
 * Everything here is synchronous, so nothing else in this process runs between the restore and the
 * exit. `SIGKILL` cannot be caught by anything — what protects against it is that the next
 * invocation finds the lock and refuses, and after a human removes it, the pristine check.
 */
export function installSignalRestoration(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      for (const child of activeChildren) child.kill('SIGTERM');
      const active = activeMutation;
      let code = SIGNAL_EXIT[signal];
      let restoreFailure: string | undefined;
      if (active !== undefined) {
        try {
          restorePristine(active.root, active.head, active.file, active.pristine);
          console.error(`${signal}: restored ${active.file} to its HEAD bytes and verified it`);
        } catch (error) {
          restoreFailure = error instanceof Error ? error.message : String(error);
          console.error(`${signal}: ${restoreFailure}`);
          code = SOURCE_INTEGRITY_EXIT;
        }
      }
      const lock = activeLock;
      if (lock !== undefined) {
        if (restoreFailure === undefined) lock.release();
        else lock.retain(restoreFailure);
      }
      process.exit(code);
    });
  }
}

export interface Variant {
  readonly id: string;
  readonly invariant: string;
  readonly expected: string;
  /** File the defect is injected into, relative to the repository root. */
  readonly file: string;
  /** Exact text to replace. The sweep fails loudly if it is absent. */
  readonly find: string;
  readonly replace: string;
  /**
   * The one test that must catch this defect, named exactly.
   *
   * A file **and** a full name, both compared exactly. Matching by substring was unsound in three
   * separate ways: a same-named test in another file could claim the kill, two tests could match at
   * once, and `"rejects invalid chain"` matched `"rejects invalid chain after retry"`.
   */
  readonly killingTest: KillingTest;
  /**
   * Which Vitest project the killing test belongs to. Defaults to `integration`.
   *
   * The harness's own controls live in the unit project — a classifier that needed a database to
   * prove it rejects a database failure would be a poor joke — so the project is per variant.
   */
  readonly project?: 'unit' | 'integration';
  /**
   * Why this variant's outcome is not `KILLED_ASSERTION`, when that is expected and correct.
   *
   * Some defects are rejected by a guard that runs *before* any test — an assertion inside a
   * migration, for instance — so the suite never starts and no test can claim the kill. That is a
   * stronger control than a test, not a missing one, and saying so here keeps the report honest
   * without inflating the evidence count.
   */
  readonly note?: string;
}

export interface Result {
  readonly variant: Variant;
  readonly baseline: MutationOutcome | 'PASSED';
  readonly outcome: MutationOutcome;
  readonly detail: string;
  readonly matched: number;
  readonly unrelatedFailures: number;
  readonly baselineMs: number;
  readonly mutantMs: number;
}

function manifest(path: string): readonly Variant[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('mutation manifest is not an array');
  return parsed as readonly Variant[];
}

/** One observed Vitest run. */
export interface Observation {
  readonly classification: Classification;
  readonly durationMs: number;
}

/** How a run is observed. The real one spawns Vitest; the harness's own tests inject a fake. */
export type Observe = (variant: Variant, phase: 'baseline' | 'mutant') => Promise<Observation>;

/** Runs one filtered Vitest invocation in `root` and observes it structurally. */
async function observe(
  root: string,
  variant: Variant,
  phase: 'baseline' | 'mutant',
): Promise<Observation> {
  const directory = mkdtempSync(join(tmpdir(), 'moin-mutation-'));
  const reportPath = join(directory, 'report.json');
  const startedAt = Date.now();
  let output: string;
  let exitCode: number | null = 0;
  let timedOut = false;

  try {
    const pending = run(
      process.execPath,
      [
        './node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        variant.project ?? 'integration',
        variant.killingTest.file,
        '-t',
        // Anchored and escaped, so the filter selects the intended test and not a longer name that
        // contains it. Vitest treats `-t` as a regular expression against the full name.
        `^${escapeForFilter(variant.killingTest.fullName)}$`,
        // The project's own reporter, because the built-in JSON report renders failures as text
        // and an assertion must be identified by what the error *is*, not by what it says.
        '--reporter=./scripts/mutation-reporter.ts',
      ],
      {
        cwd: root,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, MOIN_MUTATION_REPORT: reportPath },
      },
    );
    activeChildren.add(pending.child);
    try {
      const { stdout, stderr } = await pending;
      output = `${stdout}${stderr}`;
    } finally {
      activeChildren.delete(pending.child);
    }
  } catch (error) {
    const failure = error as {
      code?: number | string;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    exitCode = typeof failure.code === 'number' ? failure.code : null;
    // `execFile` reports a timeout by killing the child; `code` is then not a number.
    timedOut = failure.killed === true && typeof failure.code !== 'number';
  }

  let report: MutationReport | undefined;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as MutationReport;
  } catch {
    report = undefined;
  }
  rmSync(directory, { recursive: true, force: true });

  return {
    classification: classifyRun({ report, timedOut, exitCode, output, phase }, variant.killingTest),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Baseline, then mutant, for one variant whose target has just been proved pristine.
 *
 * The baseline is cached by tree plus test: several variants legitimately share one killing test,
 * and re-running it per variant would multiply the sweep's cost for no extra assurance. The cache
 * lives only for this process, is keyed on the sweep's HEAD, and is consulted only after the target
 * was shown to be that HEAD's — a cached baseline never vouches for a tree it was not measured on.
 */
async function sweepOne(
  variant: Variant,
  head: string,
  baselines: Map<string, Observation>,
  dependencies: SweepDependencies,
): Promise<Result> {
  const { root } = dependencies;
  const path = join(root, variant.file);
  // The only "original" there is: bytes proved equal to the HEAD blob in the same step.
  const pristine = capturePristine(root, head, variant.file);
  const original = pristine.toString('utf8');
  // Refused before the baseline runs: an unapplicable variant proves nothing, and its baseline
  // would be a wasted integration run.
  const applied = Buffer.from(original, 'utf8').equals(pristine)
    ? applyMutation(original, variant.find, variant.replace)
    : ({ ok: false, reason: 'the file is not valid UTF-8, so it cannot be spliced' } as const);
  if (!applied.ok) {
    return {
      variant,
      baseline: 'BASELINE_FAILED',
      outcome: 'INVALID_MUTANT',
      detail: `the variant could not be applied to ${variant.file}: ${applied.reason}`,
      matched: 0,
      unrelatedFailures: 0,
      baselineMs: 0,
      mutantMs: 0,
    };
  }

  // The cache key is everything that determines the baseline: the tree it was measured against,
  // the project, the file and the exact test name. A looser key would let one variant's baseline
  // vouch for another's.
  const key = [
    head,
    variant.project ?? 'integration',
    variant.killingTest.file,
    variant.killingTest.fullName,
  ].join('\u0000');
  let baseline = baselines.get(key);
  if (baseline === undefined) {
    baseline = await dependencies.observe(variant, 'baseline');
    baselines.set(key, baseline);
  }

  if (!baselineIsUsable(baseline.classification)) {
    return {
      variant,
      baseline:
        baseline.classification.outcome === 'SURVIVED'
          ? 'BASELINE_FAILED'
          : baseline.classification.outcome,
      outcome: 'BASELINE_FAILED',
      detail: `the killing test does not pass cleanly on the pristine tree: ${baseline.classification.detail}`,
      matched: baseline.classification.matched,
      unrelatedFailures: baseline.classification.unrelatedFailures,
      baselineMs: baseline.durationMs,
      mutantMs: 0,
    };
  }

  const write = dependencies.write ?? writeFileSync;
  activeMutation = { root, head, file: variant.file, pristine };
  try {
    write(path, applied.source);
    const mutant = await dependencies.observe(variant, 'mutant');
    return {
      variant,
      baseline: 'PASSED',
      outcome: mutant.classification.outcome,
      detail: mutant.classification.detail,
      matched: mutant.classification.matched,
      unrelatedFailures: mutant.classification.unrelatedFailures,
      baselineMs: baseline.durationMs,
      mutantMs: mutant.durationMs,
    };
  } finally {
    // The proved bytes, not a re-read and not `git checkout`: a sweep is never mistaken for a
    // revert. A restore that cannot be verified throws, which overrides the return above and ends
    // the sweep before another variant can run on top of it.
    restorePristine(root, head, variant.file, pristine, write);
    activeMutation = undefined;
  }
}

/** What a sweep needs from its surroundings. Only the harness's own tests replace the defaults. */
export interface SweepDependencies {
  readonly root: string;
  readonly observe: Observe;
  readonly write?: WriteFile;
  readonly onResult?: (result: Result) => void;
  /** Called with the finished results while the lock is still held, so the report is written under it. */
  readonly onComplete?: (results: readonly Result[], head: string) => void;
}

/**
 * Every selected variant, one at a time, against the HEAD tree, alone in this worktree.
 *
 * `manifestVariants` is the whole manifest, so that a stale mutant in any target — not only the
 * selected ones — stops the sweep: a test of file B can observe a mutant left in file A. The lock is
 * worktree-wide for the same reason, even for `--only`.
 *
 * One ownership lifecycle: the lock is taken first, before HEAD is read, and released in one
 * `finally`, after every restore has been verified and `onComplete` has run. The only exception is
 * a restore that could not be verified, which keeps the lock for a human.
 */
export async function runSweep(
  manifestVariants: readonly Variant[],
  selected: readonly Variant[],
  dependencies: SweepDependencies,
): Promise<Result[]> {
  const { root } = dependencies;
  const lock = acquireSweepLock(root, dependencies.write ?? writeFileSync);
  try {
    const head = resolveHead(root);
    lock.record(head);
    const targets = manifestVariants.map((variant) => variant.file);
    assertTargetsPristine(root, head, targets, 'before the sweep started');

    const results: Result[] = [];
    const baselines = new Map<string, Observation>();
    for (const variant of selected) {
      const result = await sweepOne(variant, head, baselines, dependencies);
      assertTargetsPristine(root, head, targets, `after ${variant.id}`);
      results.push(result);
      dependencies.onResult?.(result);
    }
    dependencies.onComplete?.(results, head);
    return results;
  } catch (error) {
    if (error instanceof RestoreFailedError) lock.retain(error.message);
    throw error;
  } finally {
    lock.release();
  }
}

function distribution(results: readonly Result[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
  }
  return counts;
}

function reportMarkdown(results: readonly Result[], head: string): string {
  const counts = distribution(results);
  const killed = counts.get('KILLED_ASSERTION') ?? 0;
  const summary = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `- **${outcome}:** ${String(count)}`)
    .join('\n');

  const rows = results
    .map(
      (result) =>
        [
          `| \`${result.variant.id}\``,
          result.variant.invariant,
          result.variant.expected,
          `\`${result.variant.file}\``,
          `\`${result.variant.killingTest.file}\` — “${result.variant.killingTest.fullName}”`,
          result.baseline === 'PASSED' ? 'passed' : `**${result.baseline}**`,
          `**${result.outcome}**`,
          `${result.detail.replace(/\|/gu, '\\|')}${result.variant.note === undefined ? '' : ` — *${result.variant.note.replace(/\|/gu, '\\|')}*`}`,
          `${String(Math.round(result.baselineMs / 100) / 10)}s / ${String(Math.round(result.mutantMs / 100) / 10)}s`,
        ].join(' | ') + ' |',
    )
    .join('\n');

  return [
    `# Audit mutation sweep — ${String(killed)}/${String(results.length)} KILLED_ASSERTION`,
    '',
    'Only `KILLED_ASSERTION` is evidence: the named test ran on the pristine tree, passed, then ran',
    'against the mutated source and rejected it on an assertion. Every other outcome is reported as',
    'itself rather than folded into a kill count.',
    '',
    `Measured against HEAD \`${head}\`, with every mutation target proved equal to its HEAD blob before`,
    'the sweep, after every variant, and on every restore.',
    '',
    summary,
    '',
    '| Variant | Invariant targeted | Expected failure if it shipped | Source | Killing test | Baseline | Outcome | Detail | Baseline / mutant |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<number> {
  try {
    return await sweepCommand();
  } catch (error) {
    if (error instanceof SweepLockError) {
      console.error(error.message);
      return SWEEP_LOCK_EXIT;
    }
    if (!(error instanceof SourceIntegrityError)) throw error;
    console.error(error.message);
    return SOURCE_INTEGRITY_EXIT;
  }
}

async function sweepCommand(): Promise<number> {
  const root = resolve(argument('--root') ?? REPO);
  const variants = manifest(resolve(argument('--manifest') ?? MANIFEST));
  const only = argument('--only');
  const reportPath = argument('--report');
  const jsonPath = argument('--json');
  const selected = only === undefined ? variants : variants.filter((v) => v.id === only);

  if (selected.length === 0) {
    console.error(only === undefined ? 'the manifest is empty' : `no variant with id ${only}`);
    return 2;
  }

  const ids = new Set<string>();
  for (const variant of variants) {
    if (ids.has(variant.id)) {
      console.error(`duplicate variant id in the manifest: ${variant.id}`);
      return 2;
    }
    ids.add(variant.id);
  }

  if (process.argv.includes('--validate')) {
    // Validation writes nothing and runs no test, so it takes no lock. But while a sweep holds the
    // lock its targets hold mutants, so a verdict now would describe that sweep's tree: refuse.
    // Nothing a sweep does relies on this result — it repeats every check under its own lock.
    const holder = sweepLockHolder(root);
    if (holder !== undefined) {
      console.error(holder);
      return SWEEP_LOCK_EXIT;
    }
    // The same pristine check the sweep starts with: anchors that resolve in a contaminated tree
    // say nothing about the HEAD tree the sweep will measure.
    assertTargetsPristine(
      root,
      resolveHead(root),
      variants.map((variant) => variant.file),
      'before validation',
    );
    const problems: string[] = [];

    for (const variant of selected) {
      const identity = variant.killingTest as KillingTest | undefined;
      if (
        identity === undefined ||
        typeof identity.file !== 'string' ||
        identity.file.length === 0 ||
        typeof identity.fullName !== 'string' ||
        identity.fullName.length === 0
      ) {
        problems.push(`[${variant.id}] killingTest must name a file and an exact fullName`);
        continue;
      }
      if (!existsSync(join(root, identity.file))) {
        problems.push(`[${variant.id}] killingTest.file does not exist: ${identity.file}`);
      }
      if (!existsSync(join(root, variant.file))) {
        problems.push(`[${variant.id}] the mutated file does not exist: ${variant.file}`);
        continue;
      }
      // The same function the sweep applies with, so validation can be neither more permissive
      // than execution nor less.
      const applied = applyMutation(
        readFileSync(join(root, variant.file), 'utf8'),
        variant.find,
        variant.replace,
      );
      if (!applied.ok) {
        problems.push(`[${variant.id}] ${variant.file}: ${applied.reason}`);
      }
    }

    // Static name resolution. `vitest list` collects without running, which is cheap and exact —
    // except for table-driven tests, whose names are built at run time, so the collector reports
    // the literal template. Those are reported as deferred rather than failed, and the baseline
    // gate enforces uniqueness for real: it requires exactly one match or it refuses the variant.
    const deferred: string[] = [];
    const filesToCheck = new Map<string, Set<string>>();
    for (const variant of selected) {
      const project = variant.project ?? 'integration';
      const key = `${project}\u0000${variant.killingTest.file}`;
      filesToCheck.set(key, (filesToCheck.get(key) ?? new Set()).add(variant.killingTest.fullName));
    }
    for (const [key, wanted] of filesToCheck) {
      const [project = 'integration', file = ''] = key.split('\u0000');
      let collected: string[];
      try {
        const listed = execFileSync(
          process.execPath,
          ['./node_modules/vitest/vitest.mjs', 'list', '--project', project, file, '--json'],
          {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: MAX_OUTPUT_BYTES,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        );
        collected = (JSON.parse(listed) as { name?: string }[]).map((entry) => entry.name ?? '');
      } catch {
        problems.push(`[${file}] could not be collected by \`vitest list\` in project ${project}`);
        continue;
      }
      const dynamic = collected.some((name) => name.includes('${'));
      for (const name of wanted) {
        const matches = collected.filter((candidate) => candidate === name).length;
        if (matches === 1) continue;
        if (matches > 1) {
          problems.push(
            `[${file}] defines "${name}" ${String(matches)} times, so no variant can name it`,
          );
        } else if (dynamic) {
          deferred.push(`${file} :: "${name}" (built at run time; confirmed by the baseline)`);
        } else {
          problems.push(`[${file}] has no test named exactly "${name}"`);
        }
      }
    }

    for (const problem of problems) console.error(problem);
    if (problems.length > 0) return 1;
    for (const entry of deferred) console.log(`deferred: ${entry}`);
    console.log(
      `mutation manifest: ${String(selected.length)} variant(s); every anchor resolves and every ` +
        `killing test is named exactly${deferred.length > 0 ? `, ${String(deferred.length)} confirmed at baseline` : ''}.`,
    );
    return 0;
  }

  installSignalRestoration();
  const results = await runSweep(variants, selected, {
    root,
    observe: (variant, phase) => observe(root, variant, phase),
    onResult: (result) => {
      console.log(`${result.outcome.padEnd(22)} ${result.variant.id}  ${result.variant.invariant}`);
    },
    // Under the lock: the report describes the tree this sweep alone measured.
    onComplete: (finished, head) => {
      if (reportPath !== undefined) {
        writeFileSync(resolve(reportPath), reportMarkdown(finished, head));
        console.log(`report written to ${reportPath}`);
      }
      if (jsonPath !== undefined) {
        writeFileSync(
          resolve(jsonPath),
          `${JSON.stringify({ head, results: finished }, null, 2)}\n`,
        );
        console.log(`machine-readable results written to ${jsonPath}`);
      }
    },
  });

  console.log('');
  for (const [outcome, count] of [...distribution(results).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${outcome.padEnd(22)} ${String(count)}`);
  }

  const notEvidence = results.filter((result) => result.outcome !== 'KILLED_ASSERTION');
  if (notEvidence.length > 0) {
    console.error('');
    console.error('Variants that did not produce evidence:');
    for (const result of notEvidence) {
      console.error(`  [${result.outcome}] ${result.variant.id}: ${result.detail}`);
      if (result.variant.note !== undefined) console.error(`      note: ${result.variant.note}`);
    }
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
