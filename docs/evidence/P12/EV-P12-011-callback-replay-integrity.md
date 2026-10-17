# EV-P12-011: M1 hotfix: durable callback acceptance; replay never changes business state; accepted callbacks keep caller number and summary

| Field | Value |
|---|---|
| Evidence ID | EV-P12-011 |
| Item | P12.12.03 |
| Date (UTC) | 2026-10-16 23:35 UTC |
| Commit | `4b8c5b7ba5e4becde5e25c2eb1f4cf15f98d9b6b` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 8.2 s); `pnpm lint` → pass (exit 0, 15.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.4 s); `pnpm typecheck` → pass (exit 0, 7.3 s); `pnpm test` → pass (exit 0, 7.9 s); `pnpm test:integration` → pass (exit 0, 35.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

A corrective hotfix to the merged M1 slice (#229, `85ad367`). An independent review found two
defects there:

- **F1:** adopting a finaliser fallback left no replay marker, so a redelivery after the owner
  completed the task reopened it and reported a new delivery.
- **F2:** adopting an existing call dropped the supplied caller number and kept the fallback's
  generic title, while the response reported success.

Corrected by migration 0077 `callback_acceptances` and a rewritten `captureCallbackRequest`. Path
and semantics: `docs/development/m1-vertical-slice.md` ("Replay is decided by a durable
acceptance record"). P12.12.03 stays IN_PROGRESS: only the callback intent is built. Nothing is
VERIFIED.

## Regression tests (real PostgreSQL 17 as `moin_app`, nothing mocked)

`apps/server/src/modules/work/callback-today.integration.test.ts`, through the HTTP route and the
authenticated `GET /api/today`:

- an adopted fallback completed or cancelled by the owner stays so on an identical replay, with
  task, call, outcome, acceptance and audit counts unchanged;
- a task the capture created and the owner completed stays completed on replay;
- six concurrent deliveries on an existing call converge on one acceptance;
- the finaliser after acceptance changes nothing, and a replay still holds;
- a distinct later request is not suppressed, and a changed request is a 409;
- an existing call without a number: the number is stored, the fallback retitled, and Today
  shows both to the right tenant only;
- a different recorded number is a 409 with nothing written;
- a retitled task is kept and the summary still lands;
- done and cancelled fallbacks stay closed while a new task carries the request.

`packages/db/src/callback-intake.integration.test.ts`:

- rollback of a failing capture, and of a failure after adoption;
- 12 rounds of capture racing `finaliseInteraction`;
- a pre-0077 created task, and a pre-0077 adopted fallback, both replay without a write;
- live repair-task adoption;
- replay after conversation erasure recreates nothing;
- replay after task erasure;
- RLS: no cross-tenant read or write;
- append-only grants (UPDATE and DELETE are refused with 42501);
- the unique constraint.

## Standard mutation-check (added 2026-10-17, closes review finding J1)

`CLAUDE.md` §5 requires `.claude/bin/mutation_check.py` to report KILLED for a fix's regression
test. The two runs below are that record. The tool was used unmodified: it reverse-applies the
non-test, non-documentation files of the fix commit, runs the test command (expected FAIL), re-applies
them, checks they are byte-identical, and runs the command again (expected PASS).

- **Fix commit:** `4b8c5b7ba5e4becde5e25c2eb1f4cf15f98d9b6b`. The checkout was at
  `c8efded1ea9a22bbb0c49a1378462750100396b6`; that commit only adds documentation to `4b8c5b7`, so
  the with-fix run exercises the same source.
- **Mutation target (reverse-applied by the tool, `--fix-paths`):**
  `packages/db/src/callback-intake.ts`, `packages/db/src/tasks.ts`, `packages/db/src/finaliser.ts`,
  `packages/db/src/index.ts`, `packages/contracts/src/today.ts` and
  `apps/server/src/modules/call-simulator/http/call-simulator.controller.ts`. This restores the
  merged `85ad367` behaviour of those six files. Migration 0077 is **not** reverted on purpose:
  the tests read `callback_acceptances` to take state snapshots, and without the table they would
  fail on a missing relation, which is a setup error and not the defect.
- **Test command:** the tool's `--test` was a thin wrapper, not committed (it is session-local),
  that exports the `TEST_*` database variables from `.env.example`, unsets `NODE_ENV`, and runs

  ```text
  node ./node_modules/vitest/vitest.mjs run --project integration --reporter=verbose \
    apps/server/src/modules/work/callback-today.integration.test.ts -t "<F1:|F2:>"
  ```

  against real PostgreSQL 17 as `moin_app` (nothing mocked), with the full vitest output written to
  a log, because the tool keeps only the last 40 lines.

| Run | Selector | Started (UTC) | Without fix | With fix | Verdict | Restored byte-identical |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `F1:` (6 tests) | 2026-10-17T04:10:48Z | exit 1: 4 failed, 2 passed | exit 0: 6 passed | **KILLED** | yes |
| 2 | `F2:` (3 tests) | 2026-10-17T04:10:55Z | exit 1: 3 failed | exit 0: 3 passed | **KILLED** | yes |

Before run 1 the unmutated `F1:` selector was run once on its own: 6 passed, exit 0.

Command for both runs (`MC_FILTER` selects `F1:` or `F2:`):

```text
python3 .claude/bin/mutation_check.py --fix-ref 4b8c5b7ba5e4becde5e25c2eb1f4cf15f98d9b6b \
  --fix-paths packages/db/src/callback-intake.ts packages/db/src/tasks.ts \
  packages/db/src/finaliser.ts packages/db/src/index.ts packages/contracts/src/today.ts \
  apps/server/src/modules/call-simulator/http/call-simulator.controller.ts \
  --test "<wrapper script>" --timeout 600
```

Tool output: `fix restored byte-identical: yes`; `tree_changed_by_tests: false`; `git status` clean
afterwards.

### Why each run was killed (assertions in the retained logs)

All failures are assertion failures in the test bodies. There was no compile error, import error,
missing relation, migration error or runner crash in either run.

Run 1, `F1:` (`callback-today.integration.test.ts`):

| Test | Assertion that failed on the merged code | Meaning |
| --- | --- | --- |
| adopted fallback, owner sets `done`, identical replay leaves it `done` (line 663) | `expected 201 to be 200` | the replay was processed as a new delivery |
| the same, owner sets `cancelled` (line 663) | `expected 201 to be 200` | same |
| six concurrent deliveries converge on one acceptance (line 690) | `expected [201, 201, 201, 201, 201, 201] to strictly equal [200, 200, 200, 200, 200, 201]` | five of six duplicates were not recognised |
| a distinct later request is not suppressed; a changed request is a conflict (line 744) | `expected 200 to be 409` | the same call with different content was accepted as a replay |

The other two F1 tests (a task the capture created itself, and the finaliser after acceptance)
pass on the merged code. That is expected: the defect only exists when the capture adopts a
finaliser fallback.

Run 2, `F2:`:

| Test | Assertion that failed on the merged code | Meaning |
| --- | --- | --- |
| existing call without a number: number stored, fallback retitled, Today shows both (line 765) | `expected null to be '+4915133334444'` | the caller number was not persisted |
| a different recorded number is a conflict: 409, nothing written (line 789) | `expected 201 to be 409` | a conflicting number was accepted |
| the same recorded number is accepted; a retitled task is kept and the summary still lands (line 813) | `expected '<task id>' not to be '<task id>'` | the summary was not carried by a separate task |

### Limits of this evidence

- The first failing assertion in each F1 replay test is the HTTP status, so the later
  whole-state snapshot comparison (status, version, timestamps, audit counts) was never reached on
  the merged code. The run proves the replay is mishandled as a new request; the reopening of
  completed work itself was established by the independent review of the merged code and by the
  earlier whole-suite run against the merged file (below), not by these runs.
- The tool reverts six source files together. It does not isolate individual lines of the fix.
- The wrapper script and logs are in the session scratchpad and are not committed. The wrapper
  pins Node v24.21.0 (the `.nvmrc` version). An earlier pair of runs at 04:08Z used the shell's
  default Node v26.10.0, with the same verdicts and the same failing assertions; it was repeated
  under the pinned version and is superseded. Its evidence JSON stays under
  `.git/claude-evidence/mutation/` (`20261017T040827Z`, `20261017T040851Z`); its logs were not kept.
- Retained locally for the pinned-Node pair: `.git/claude-evidence/mutation/20261017T041048Z.json`
  (F1) and `.git/claude-evidence/mutation/20261017T041055Z.json` (F2), each with its `.patch`.
  Verbose logs (SHA-256): F1 without fix
  `dd2d0d2f24ec7c47c1da757b42b735a708830f59cb00b07aa0cb0c23c2619c03`, F1 with fix
  `0543ad88a3b25d4d9e67afe28311b653cad2912dd00e6f1c00b5c156e3419244`, F2 without fix
  `39d06971042be29569cd8da528d5fba5c2f584d42e7d3d0f1bee203ebdffa24c`, F2 with fix
  `33b4cb0d97784dcca1f2dd5ad9b35da0889b50b316e900fac59ac3ba78c326fe`. The assertion lines above
  are copied from those logs.

## Supplementary checks (not equivalent to the standard mutation-check)

These were recorded in the first version of this record. They stay for provenance, with the
corrections below.

- **Against the merged code (custom):** `callback-intake.ts` from `85ad367` was restored
  temporarily, with only a stub of the new error class so imports resolve, and then restored
  byte-identical. 19 of the new or changed tests failed on it, including the exact F1 sequence and
  both F2 cases. No log of that run is committed. The standard checks above supersede it for governance
  purposes.
- **Against the fix (custom scratch harness, 11 mutants of the fixed code):** the harness counted
  any nonzero test exit as KILLED and did not keep the failing assertions (its own output
  printed "0 failing lines"). It therefore shows that the suite exited nonzero on each mutant, not
  that an assertion tied to that behaviour failed, and it is **not** evidence of 11 assertion-verified
  kills. Two of the original labels did not match the change that was made:
  - "replay check moved after the ingest" actually deleted the replay check, the same change as
    "replay check skipped"; no run moved it;
  - "a different number overwritten" actually removed the `caller-differs` conflict. The guarded
    `update ... where from_number is null` then writes nothing, so the number is not overwritten,
    but a misleading `call.caller_number` audit row is written.

  The scratch script now holds only 5 of the 11 definitions; all 11 were recovered from the session
  transcript for this correction. The "finaliser lock dropped" mutant targets a race and was not
  checked for flakiness. The list is kept for history:
  replay check skipped; (mislabelled) replay check after ingest; pre-0077 outcome rule removed; a
  changed request accepted; caller number not settled; (mislabelled) a different number
  overwritten; fallback not retitled; an occupied task treated as free; acceptance not recorded;
  finaliser lock dropped; Today type not derived.

## Open follow-ups from the independent review (not fixed here, not blocking this PR)

- **J2, historical cancelled-fallback replay.** For a call captured before migration 0077 that
  has the `callback_requested` outcome and no acceptance row, `priorAcceptance` picks the carrier
  with `order by created_at limit 1` over tasks that are `type = 'callback'` or finaliser
  fallbacks. In the reviewer's case the fallback was cancelled and a callback-specific task
  exists as well; the replay then returns the older fallback's id, not the callback task's. Nothing is written, so
  owner work is untouched; only the returned `taskId` can be wrong. Expected selection: prefer
  `type = 'callback'`, and only then a finaliser fallback. Needs a pre-0077 fixture with a
  cancelled fallback plus a later callback task. Suggested owner: the next P12.12 slice, or a small
  separate corrective PR if the founder wants it sooner. It does not block this PR.
- **J3, task and audit lock order.** Per the independent review, capture can hold the audit-head lock (an audit append) before
  it waits for the task row it adopts; an owner task write that locks the task row first and then
  appends audit can wait the other way. PostgreSQL would detect the cycle (40P01) and roll one
  transaction back. This has **not** been reproduced. Needed before owner task-write endpoints are
  exposed: one agreed lock order or a bounded retry, with a targeted concurrency test. It does
  not block this PR.

Both stay open: not accepted, not VERIFIED.

## Reviews

- **QG-09 security, architecture and invariant reviews:** no CRITICAL or HIGH. Their MEDIUMs
  fixed with tests:
  - the replay check now runs before any write (erasure resurrection);
  - pre-0077 captures are recognised;
  - the caller number was removed from the request hash;
  - a retitled task keeps the summary on a new task;
  - a carrier key that cannot collide with older keys;
  - finaliser tasks are recognised by key;
  - an index for SET NULL on erasure.
- **Open, none HIGH:** the derived callback type on Heute only (an ADR for the index); acceptance
  rows outliving erasure (P16); the hash covers the derived summary; pre-0077 calls have no
  tombstone; the shared advisory-lock keyspace.
- **Advisory review:** inconclusive; it returned no structured verdict.
