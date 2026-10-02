# EV-P06-035: Mutation sweeps made exclusive per Git worktree by an atomic mkdir lock taken before any source is read, after two concurrent sweeps were shown to measure each other's mutants

| Field | Value |
|---|---|
| Evidence ID | EV-P06-035 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 23:58 UTC |
| Commit | `cdb5f862bf0fd7feac72f6c0f9af0029371cb274` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 30.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.0 s); `pnpm exec prettier --check .` → pass (exit 0, 4.2 s); `pnpm lint` → pass (exit 0, 4.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.5 s); `pnpm test` → pass (exit 0, 7.5 s); `pnpm test:integration` → pass (exit 0, 11.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

The independent QG-09 review of `eb0c8d8` found one remaining blocker: two mutation sweeps could
mutate the same worktree at once. Harness only. `git diff --stat eb0c8d8..HEAD -- packages apps` is
empty, so the provenance code, `packages/db` and the migrations are untouched.

## Reproduced before the fix

The review's shape, rebuilt as real processes: M1 (`one = 1 → 100`) and M5 (`five = 5 → 500`) in the
same file, sharing one killing test. Each sweep was the production `runSweep` in its own Node process
(`scripts/__fixtures__/sweep/paused-driver.ts`). Vitest was replaced by an observer that records the
bytes on disk at the moment a test would run, and that can be held at a named point. Interleaving:
A and B both pass the pristine check and reach their baselines; A writes M1 and holds; B writes M5
and holds; A's test runs; then B's.

| Sweep | Run | Bytes the test executed against |
| --- | --- | --- |
| A | baseline:M1 | pristine |
| A | mutant:M1 | `one = 1`, `five = 500`, which is **M5, not M1** |
| B | baseline:M5 | `one = 100`, which is **A's M1** |
| B | mutant:M5 | pristine, because A's restore had already run |

Both reported `KILLED_ASSERTION`, the file ended pristine, and every per-variant and final check
passed. Each sweep restored exactly what it had written, so no restore or cleanliness check could
see the overlap. The review's description understated it: B's baseline was contaminated too.

## The lock

| Property | How |
| --- | --- |
| primitive | `mkdirSync(path)` without `recursive`: it creates the directory or fails with `EEXIST`, atomically, with no check first |
| location | `$(git rev-parse --absolute-git-dir)/moin-mutation-sweep.lock`. That is the worktree's own Git directory: `.git/` for the main worktree, `.git/worktrees/<name>/` for a linked one. In this repository it resolves to `/home/adam/projects/business/moin/.git/worktrees/moin-audit/moin-mutation-sweep.lock` |
| order | lock → HEAD → owner record → all-target pristine check → per variant: capture, baseline/cache, mutant, restore, verify, all-target check → `onComplete` (report written) → release |
| release | one `finally` in `runSweep`; idempotent; removes only a lock whose `owner.json` still carries this process's random token |
| restore failure | a `RestoreFailedError` (a `SourceIntegrityError`) **retains** the lock, with the reason in its record, so the next sweep refuses until a human has looked |
| owner record | pid, hostname, cwd, root, HEAD, start time, token. Diagnostics only. If it cannot be written, the lock is released and the sweep aborts |
| existing lock | `SweepLockError`, exit `4`, the holder's record and the recovery steps in the message. Never removed or overwritten automatically |
| signals | `SIGINT`/`SIGTERM`: kill the Vitest child, restore and verify the active target, then release (or retain on a failed restore), then exit `130`/`143`. All synchronous |
| `SIGKILL` | not handled; nothing can handle it. The lock and possibly a mutant remain, and the next sweep refuses. After manual removal, the HEAD-pristine check refuses a leftover mutant |
| `--validate` | read only, so it takes no lock. It refuses with exit `4` while a lock exists. No sweep relies on its result; the sweep repeats every check under its own lock |
| `--only` | the same worktree-wide lock |

Live, in this worktree: while the regeneration sweep held the lock, a second
`node scripts/mutation-sweep.ts --only H1-…` and a `--validate` both exited `4`, naming the holder's
pid and HEAD.

## Regressions (`scripts/mutation-sweep-lock.test.ts`, 13 tests)

| Case | Result |
| --- | --- |
| **The review's M1/M5:** A holds at baseline:M1; B starts with M5 | B exits `4` naming A's pid; B's observer log is **empty** (no baseline, no mutant); the file is untouched. A then observes the HEAD bytes, then **exactly M1**, reports `KILLED_ASSERTION`, restores, and the lock is gone |
| A has M1 on disk; CLI `--only M5` | exit `4`, not `3`; no variant line; A's mutant untouched |
| 8 sweeps started at once | exactly one owner; 7 exit `4` with empty logs |
| `SIGINT` while held at a baseline | exit `130`, lock released |
| a linked worktree (`git worktree add`) while the main one is locked | lock paths differ, and the linked one is under `.git/worktrees/<name>/`. The linked sweep exits `0` having observed its own M5; the main file is untouched |
| `SIGKILL` during mutant:M1 | lock and mutant remain. `--only M5`, `--only MB` (other file) and `--validate` all exit `4` with the pid and recovery text. The pid is confirmed dead and the lock removed by hand; the next sweep exits `3` on the leftover mutant. After restore, a run observes exactly M5 |
| a foreign lock and a dirty tree | `SweepLockError`, not `SourceIntegrityError`; zero observations; the foreign record is byte-identical |
| normal run | lock present during every observation and during `onComplete`, when the tree is already pristine; gone afterwards |
| observer throws, as a reporter failure would | target restored, lock released |
| failed baseline · refused tree | lock released |
| owner record unwritable | `could not record ownership`, zero observations, lock released |
| double release · release after manual removal and re-acquisition by another | idempotent; the other's lock is left in place |

In `mutation-sweep-isolation.test.ts`, the real `SIGTERM`/`SIGINT` tests now also assert the lock
is gone after the verified restore. The restore-failure test now asserts that the next sweep is
refused by the **retained lock** and, once the lock is removed, by the pristine check.

One test was corrected during the self-mutation check. As first written, the M1/M5 regression read
the lock's `owner.json` with a plain `readFileSync` before asserting anything about B, so with no
lock (`H39`) it failed on an `ENOENT` and was classified `INFRA_FAILURE`, not
`KILLED_ASSERTION`. It now asserts by matcher that B never reached its observer first. It waits for
B to be refused or held, never for B's exit, which an unrefused B would not reach.

## Lock self-mutations

All four came back `KILLED_ASSERTION`, both alone (`--only`) and in the full sweep.

| Variant | Removes | Killing test |
| --- | --- | --- |
| `H39-sweep-takes-no-lock` | lock acquisition, replaced by a no-op | the M1/M5 regression (B reaches its baseline) |
| `H40-sweep-checks-the-source-before-taking-the-lock` | lock-first order: HEAD and the pristine check run before acquisition | foreign lock and dirty tree must give `SweepLockError`, not `SourceIntegrityError` |
| `H41-sweep-releases-the-lock-before-its-work-is-done` | holding the lock: it is released straight after being recorded | the M1/M5 regression |
| `H42-sweep-locks-the-whole-repository` | worktree scope: `--git-common-dir` instead of `--absolute-git-dir` | linked worktree sweeps while the main one is locked |

Not added:
- A variant that releases the lock before the restore inside the signal handler. The handler is
  synchronous, so no observer in another process could reliably land in that window, and the variant
  could not be killed soundly.
- A variant that skips the owner-record write. The record is diagnostics, and correctness does not
  depend on it.

`H34`, `H35` and `H38` were re-anchored to the deeper indentation of the new `try` block. `H34` and
`H35` still resolved before that, but only as substrings of the indented line, so they are now exact.

## Proofs

| Check | Result |
| --- | --- |
| `mutation_check.py --fix-ref b1b77bd` (`scripts/mutation-sweep.ts`) against "the second is refused before any baseline…" | **KILLED**: fails without the fix, passes with it, restored byte-identical |
| `gates.py stress`, 20 iterations of `mutation-sweep-lock.test.ts` + `mutation-sweep-isolation.test.ts` | **20/20 PASS**. Each iteration asserts the M1/M5 interleaving (B refused before baseline, A observes only M1) and 8 simultaneous contenders (exactly one owner). That is 20 M1/M5 runs and 160 contended starts with zero double owners, zero wrong-mutant observations, and zero second sweeps reaching a baseline |
| harness suites | 133 tests: lock 13, isolation 15, surface 9, realvitest 28, probe 13, sweep 9, outcome 31, reporter 15 |
| `pnpm test` (unit) | 40 files, 448 tests |
| `packages/db` focused evidence suites | 63 tests, unchanged: 24 / 8 / 10 / 8 / 2 / 11 |
| provenance and export regressions | unchanged and passing: hidden `beginEvidence`/`confirmTerminal`, one-shot `installProbe`, the plain-`it` exploit `NOT_ELIGIBLE`, every object-identity attack |

## Mutation corpus, regenerated

`--validate` at `1a924a0`: 107 variants, every anchor resolves, every killing test named exactly.
The full sweep at `1a924a0` held this worktree's lock throughout, and every baseline passed:

- **KILLED_ASSERTION: 105**
- **NOT_EVIDENCE_ELIGIBLE: 2**: `N8-backfill-removed` and `P8-sequence-backfill-removed`, unchanged.
  A migration guard detects each defect, so no matcher throws.

`101/2 over 103` is superseded. The difference is the four lock variants; none of the previous 103
changed outcome.

## Scope held

`git diff --stat eb0c8d8..HEAD -- packages apps` is empty. ADR-0017 stays **PROPOSED**, and the PLAN
Status Ledger is unchanged. PR #31 stays a draft.
