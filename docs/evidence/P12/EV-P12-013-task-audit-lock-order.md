# EV-P12-013: J3: task rows and conversation locks are taken before the tenant audit head in the callback capture and the orphan sweep; no 40P01 against owner task writes

| Field | Value |
|---|---|
| Evidence ID | EV-P12-013 |
| Item | P12.12.03 |
| Date (UTC) | 2026-10-17 05:28 UTC |
| Commit | `5602fedb48fd000d4b3196379afe9677098ee3f7` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 8.1 s); `pnpm lint` → pass (exit 0, 3.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 6.9 s); `pnpm test` → pass (exit 0, 7.2 s); `pnpm test:integration` → pass (exit 0, 32.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

Mission J3, found by the independent review of PR #230. Nothing here is VERIFIED; P12.12.03 stays
IN_PROGRESS.

**The cycle.** `appendAuditEvent` locks the tenant's `audit_heads` row (an
`INSERT ... ON CONFLICT DO UPDATE` inside `app.append_audit_event`, migration 0008) and holds it to
COMMIT, so every audit append serialises its tenant. Lock orders found in the code:

| Path | Order | Status |
| --- | --- | --- |
| Owner task write: `setTaskStatus`, `assignTask`, `snoozeTask`, `retitleSystemTask` (and `reopenTask`, `completeTask` through them) | task row (the `UPDATE`), then head | proven by reading the code |
| Callback capture before this change | CallSid and conversation advisory locks, call row, **head** (call status, outcome and caller-number audits), then **task rows** (`existingCallbackWork`, `FOR UPDATE`) | proven by reading; **reproduced**: 40P01 on every forced run |
| Orphan sweep (`reconcileOrphans`) before this change | one tenant transaction over many conversations: after the first finalisation's audit append (head held), the next conversation's advisory lock and fallback row | proven by reading; **reproduced** against an owner holding the row and against a capture holding the lock |
| `finaliseInteraction` alone, repair path | advisory lock, then the row, with no audit before it | no head-before-row edge |
| `createTask` | inserts a new row, or reads on conflict | no edge in the call contexts inspected (not a guarantee about every insert, unique or foreign-key wait) |
| `resolution.ts` `delete from tasks` | deletes the row the same transaction just created | no contention possible |
| `merge.ts` unmerge `update tasks` | the code comment says the branch is never used | not traced, not exercised |

**The fix: one order, no retry.** Task rows and conversation locks are taken before the first audit
append in both affected paths:

- `callback-intake.ts`: `lockCallbackCandidates` locks the conversation's `type = 'callback'` and
  `finaliser-fallback:%` tasks, `ORDER BY id FOR UPDATE`, right after the CallSid and conversation
  locks and before anything is written (only when the call already existed; a new call has no
  tasks). It is `FOR UPDATE`, the strongest level the later statements use, so none of them waits
  again behind a holder that waits for the head.
- `finaliser.ts`: `lockOrphans` takes every orphan conversation's advisory lock in sorted order, then
  their fallback rows by id, before the sweep's first finalisation.

No bounded retry: the order removes the cycle, and a retry would need a whole-transaction harness.
No migration, no new endpoint. The new row locks are per conversation (and tenant-scoped by row-level security); the advisory-key caveat in the limits applies.

## Regression tests (real PostgreSQL 17 as `moin_app`)

`packages/db/src/task-audit-lock-order.integration.test.ts`, 7 tests. Each forces the interleaving:
the other transaction holds the row or lock, the waiter is observed in `pg_locks` blocked by that
exact backend (`pg_blocking_pids`), and only then does the real write run (`setTaskStatus`,
`completeTask`, `reopenTask`, or the capture/sweep). No sleeps decide the order.

What each test asserts, beyond that its outer transactions succeed and none was rejected (every
race test checks the rejections' SQLSTATEs; for the sweep tests the sweep's own tenant-transaction
failure is counted in `failed`, see the note below). `chain valid` means `verifyAuditChain` returns
valid: it shows the chain is intact, not that no business row was duplicated. No test counts
outcome rows or the total number of tasks of a conversation.

| Test | Asserted |
| --- | --- |
| capture vs owner moving the fallback to `in_progress` | the capture adopts the same task; status `in_progress`, retitled, version 3; the task's audit operations are exactly `task.create, task.status, task.retitle`; one acceptance row; one `callback.accept` event; chain valid |
| capture vs owner completing / cancelling the fallback (2 tests) | the original task stays closed; a distinct open untyped task carries the summary; one acceptance row; chain valid |
| finaliser repair vs owner reopening (guard, passes on the old code) | verdict `task-existed`; the task is open; chain valid |
| another tenant while this one waits (see the note below) | tenant B's owner write and capture complete within 5 s while tenant A's capture is still blocked by A's owner; after A is released both A transactions commit; both chains valid |
| sweep vs owner reopening the second orphan's fallback | `failed: 0`; first orphan `fallback-created`; second `task-existed`; the fallback is open; chain valid |
| sweep vs a capture holding the second orphan's conversation lock | capture is a first delivery (`replayed: false`); `failed: 0`; first orphan `fallback-created`; second `outcome-existed`; one acceptance row; chain valid |

Note on the tenant test: its tenant-B progress assertions are a guard, but the test also contains
tenant A's capture-vs-owner race, so on the old order it fails (`40P01` on A's transactions, see the
mutation table). Only the finaliser-repair test passes on the old code as a whole test.

Note on the sweep tests: `reconcileOrphans` catches a failed tenant transaction and returns a normal
report with `failed` incremented, so these tests assert no outer rejection and `failed: 0`. Without
the fix the retained mutation logs show `failed: 1`; that the cause is PostgreSQL's deadlock
rollback (`40P01`) is inferred from the forced lock graph, not captured as an error code.

## Standard mutation-check

`python3 .claude/bin/mutation_check.py --fix-ref 8c65d87 --fix-paths <file> --test <wrapper>`
(wrapper: vitest `--project integration --reporter=verbose` on the file above, Node 24.21.0,
`TEST_*` from `.env.example`, full log kept), fix commit `8c65d87`:

| Fix reversed | Selector | Without the fix | With the fix | Verdict |
| --- | --- | --- | --- | --- |
| `callback-intake.ts` (2026-10-17T05:24:08Z) | the capture and tenant tests (5) | exit 1: 4 failed, 1 passed | exit 0: 5 passed | **KILLED** |
| `finaliser.ts` (2026-10-17T05:23:55Z) | the reconciler tests (2) | exit 1: 2 failed | exit 0: 2 passed | **KILLED** |

Without the callback fix, the four failures are all the same assertion: `expected [ '40P01' ] to
strictly equal []`, a transaction rolled back by PostgreSQL's deadlock detector (the three
assertion sites are test lines 226, 272 and 409). Without the finaliser fix both sweeps return
`failed: 1` instead of 0, because the tenant transaction was rolled back (lines 504 and 564). The
one capture-side test that passes without the fix is the finaliser guard. An earlier run of the
callback check at 05:23:48Z used a filter that matched one test and is superseded.

Retained locally: `.git/claude-evidence/mutation/20261017T052408Z.json` (callback),
`20261017T052355Z.json` (finaliser), each with its `.patch`. Verbose log SHA-256: callback without
fix `c66a147a8ec470451da4e56c8340b172af5dec67b225cf285639ecc1830513a4`, with fix
`5d53bc215cdee7c748c40bc8de5feb45e123c15cfc20d03a8599b0f3bf0b98be`; finaliser without fix
`edf90e70c403e91da283c9d137dca84a0d71b4593a2aa9fce5f31aa71533148c`, with fix
`0eaa79c0ee4c6575bcc6cd3a38f6b6db0532b1aee82eb3af319bfb2866e7b990`. The later commit `5602fed`
only changes how a test helper reads an error code.

**Repeated runs.** The repository's `gates.py stress` runs the unit project only and cannot select
this file (it ran no tests and exited 1 twenty times; that record, `20261017T051956Z-stress.json`,
is not counted). Instead the file was run 20 times in a row under the integration project by a
small script, retained locally as `.git/claude-evidence/repeat-20261017T054220Z.json` (SHA-256
`e18c9b0839790f1d4ad7c711edb940ed2e48ba18e16c554f4771d9ac8929e777`): command
`vitest run --project integration packages/db/src/task-audit-lock-order.integration.test.ts`,
head `a38ac33f75f2348392e696bc3eec6adda0a51ca4`, clean worktree, 20 iterations each exit 0 with
`7 passed (7)`. An earlier 20-run loop with the same result did not keep a record and is not
counted. This is a repeat run, not proof that deadlocks are impossible.

## Reviews (QG-09, on the fix commit)

- **Security:** no CRITICAL or HIGH; OK TO MERGE. Tenant isolation and the lock scope confirmed;
  asked for `pg_blocking_pids` in the tests (done) and not to cite the finaliser guard as evidence
  for the fix (not cited). It flagged `merge.ts` and `resolution.ts`: traced above (not
  contended / not exercised).
- **Architecture:** edge analysis confirmed. Raised a HIGH residual in `reconcileOrphans`
  (fixed here, with tests), suggested `FOR NO KEY UPDATE` (rejected with a reason in the code: a
  weaker level could be upgraded later behind a holder that waits for the head), and asked for the
  single-task assumption to be documented (done).
- **Invariant:** capture path passes; the same sweep residual found independently (fixed here).
  Remaining low-confidence points are in the limits below.

## Limits

- A transaction that writes two tasks with an audit append between them is not ordered by this.
- Other tables' row-then-audit orders (for example `staleness.ts`) were not traced.
- The unmerge helper's `update tasks` branch was not exercised; its comment says it is unused.
- `hashtext` advisory keys are 32 bits with no tenant, SID or conversation namespace. A collision
  can serialise unrelated work, including across tenants, and can in principle form a residual
  cross-key deadlock before any audit append (for example capture A holding the key of its SID and
  wanting the key of its conversation, while capture B holds the colliding keys the other way
  round). This is structural and not reproduced; the fix removes the task-row/audit-head cycles
  under the assumptions above, not general deadlock freedom. A key namespace would be a migration
  and is out of scope.
- No owner task-write endpoint exists yet; the owner side is simulated with a held row lock and the
  real `setTaskStatus`, `completeTask` and `reopenTask`.
- Run on one machine; 20 repeats are not a proof of absence.
- This record shares the P12.12.03 item with EV-P12-012 (PR #231). A read-only `git merge-tree`
  of the two branches merges the code cleanly (`callback-intake.ts`, `finaliser.ts`) and conflicts
  in `PROGRESS.md` (front matter `mission` and `next`, and the appended sections),
  `docs/evidence/INDEX.md` and `docs/development/m1-vertical-slice.md`. The second PR to merge
  needs those resolved by hand: one coherent front matter, both ledger sections, both evidence
  rows, both open-findings entries.
