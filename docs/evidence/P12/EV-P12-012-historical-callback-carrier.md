# EV-P12-012: J2: a pre-0077 callback replay names the task that capture used (keyed carrier), not an older cancelled fallback; replay still writes nothing

| Field | Value |
|---|---|
| Evidence ID | EV-P12-012 |
| Item | P12.12.03 |
| Date (UTC) | 2026-10-17 04:39 UTC |
| Commit | `0025f49dcc0fd2c7ccc2e319b9a753666900d1ee` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 7.2 s); `pnpm lint` → pass (exit 0, 3.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 5.8 s); `pnpm test` → pass (exit 0, 6.9 s); `pnpm test:integration` → pass (exit 0, 30.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

Mission J2, a follow-up to the callback replay correction (EV-P12-011, PR #230 `49352e0`). For a
call captured before migration 0077 (no acceptance row, recognised by its `callback_requested`
outcome), the replay response named the oldest task that was typed `callback` or a finaliser
fallback. When that capture had found the fallback cancelled, it had created an untyped
replacement keyed `callback:<conversation>`, and the older cancelled fallback (itself typed
`callback`) was returned instead. Nothing was written, but the id named work that carried no
request. P12.12.03 stays IN_PROGRESS. Nothing is VERIFIED.

The lookup (`legacyCarrier` in `packages/db/src/callback-intake.ts`) now uses the key, because the
type cannot tell the two apart:

1. the task keyed `callback:<conversation>`, in any status (the capture's own task, or the
   replacement for a cancelled fallback);
2. else the fallback under its exact key `finaliser-fallback:<conversation>` if it is not
   cancelled (an adopted one; repair tasks have other keys and are never matched);
3. else `taskId: null`.

`fallbackKey` is exported from `finaliser.ts` so the key format stays in one place. No migration.

## Regression tests (real PostgreSQL 17 as `moin_app`)

`packages/db/src/callback-intake.integration.test.ts`, describe "a pre-0077 replay names the task
that capture used (J2)", 10 tests. The old capture's writes are staged by hand from `85ad367`
(the old code cannot be run). What each test asserts (`taskStates` reads eight task columns: id,
status, type, title, version, created_at, updated_at, idempotency_key; `footprint` reads counts of
calls, outcomes, acceptances and tasks, the caller number, task titles and versions, and the
tenant's audit total; neither reads whole call or outcome rows or `call_events`):

| Test | Returned identity | Task snapshot unchanged | Footprint unchanged |
| --- | --- | --- | --- |
| cancelled typed fallback plus keyed replacement: the replacement is named | yes | yes | yes |
| the replacement completed or cancelled by the owner: still named (both statuses) | yes | yes | no |
| the replacement erased: `taskId: null`, the fallback stays cancelled | yes | yes | yes |
| a live adopted fallback is named | yes | yes | no |
| an adopted fallback the owner cancelled later: `taskId: null` (see limits) | yes | yes | no |
| the keyed replacement wins over a fallback that is live again | yes | no | no |
| an open finaliser repair task next to the replacement is not named | yes | yes | no |
| an adopted fallback the owner completed is still named | yes | no | no |
| another tenant's CallSid is not answered with this tenant's task | yes (not the other tenant's ids) | the other tenant's tasks only | no |
| each tenant is told its own replacement; tenant A cannot read tenant B's replacement by key or id (one direction only) | yes | no | no |

The replay path's absence of writes rests on the code (the replay returns before any write; both
lookups are `select`s) and on these snapshot and footprint comparisons, not on a comparison in
every test.

## Standard mutation-check

`python3 .claude/bin/mutation_check.py --fix-ref e5d69e5 --fix-paths packages/db/src/callback-intake.ts
packages/db/src/finaliser.ts --test <wrapper> --timeout 600`, where the wrapper runs vitest
(`--project integration --reporter=verbose`, Node 24.21.0, `TEST_*` from `.env.example`) on the file
above with `-t "a pre-0077 replay names the task that capture used"` and keeps the full log.

| Run (UTC) | Tests in selector | Without the fix | With the fix | Verdict |
| --- | --- | --- | --- | --- |
| 2026-10-17T04:36:08Z (head `b159913`, final tests) | 10 | exit 1: 7 failed, 3 passed | exit 0: 10 passed | **KILLED** |
| 2026-10-17T04:50:37Z (head `6ee34ea`, after review round 1) | 10 | exit 1: 7 failed, 3 passed | exit 0: 10 passed | **KILLED** |
| 2026-10-17T04:34:12Z (head `e5d69e5`, first 6 tests) | 6 | exit 1: 5 failed, 1 passed | exit 0: 6 passed | **KILLED** |

Fix files restored byte-identical; `tree_changed_by_tests: false`. The later commit `0025f49` only
types the helper's rows (lint) and does not change what the tests assert.

Failures without the fix are assertion failures in the test bodies (no import, compile or setup
errors): the replay `taskId` was the cancelled fallback's id, or an id where `null` was expected.
The three tests that pass without the fix are guards, not detectors: the live adopted fallback, the
completed adopted fallback, and the other tenant's CallSid.

Round-1 rerun (`20261017T045037Z`, covers the comment-only change to `callback-intake.ts`) logs
(SHA-256): without fix `d3303b7714ef48881db5393bfbfc5c30dbe40a604f4bb491be2ed0faa68ea938`, with fix
`269dbe3d2328732850ebb9527006eafedbd35185c52b018a991675b23bb9d71d`. Local gates: `gates.py full`
PASS 14/14 on `6ee34ea` (`20261017T045044Z-full.json`).

Retained locally: `.git/claude-evidence/mutation/20261017T043608Z.json` and `.patch`
(`20261017T043412Z` for the first run). Verbose logs (SHA-256): without fix
`117838ae43eb96d017027e5a12ea1821d7c33fa84b4075b74025917c666fa46f`, with fix
`d1e36c434b18965935fc060ea9020bc36c179dc29977856325e62ed566890f3f`.

## Reviews (QG-09, on `49352e0..e5d69e5`)

- **Security:** no CRITICAL, HIGH or MEDIUM; OK TO MERGE. Two LOW test gaps (key precedence, a
  done fallback, cross-tenant through the real path): added in `b159913`.
- **Architecture:** no CRITICAL or HIGH; OK TO MERGE. Lookup checked against every pre-0077 branch.
  LOW: the repair-task case: added in `b159913`.
- **Invariant:** no bypass in the diff. Findings outside its scope, recorded not fixed:
  - MEDIUM, existing limit: a pre-0077 call whose conversation is erased replays as a first
    delivery (no tombstone; documented in the slice doc since PR #230; no deployed data exists);
  - LOW: a pre-0077 replay does not compare the request (no hash exists for it);
  - LOW, refuted: adopted repair tasks. The pre-0077 capture only adopted tasks typed `callback`
    (`85ad367`), and repair tasks have no type.

## Limits

- An adopted fallback the owner cancelled later, and a replaced fallback whose replacement was
  erased, are the same stored state. The replay returns `taskId: null` for both; the id of a
  cancelled fallback is never named.
- Pre-0077 data is staged by hand from the old code's writes, not produced by the old code.
- Run locally only; the gate and mutation runs used one machine.

## Independent review rounds

- **J2-R1** (Codex, head `7f4a55f`): REQUEST_CHANGES. No runtime defect found. Blocking: this record
  and the PR said every replay case compared full task rows and the call footprint; the table above
  states what is actually asserted. The KILLED result itself was confirmed. Non-blocking: the
  `CapturedCallback.taskId` comment said null only meant erased, and the slice document said "live
  fallback" where the code accepts any non-cancelled fallback; both corrected (comment and
  wording only). The comment change alters `callback-intake.ts` after the fix commit; behaviour is
  unchanged and the mutation check was rerun (below).
- **J2-R2** (Codex, head `ae550dc`): REQUEST_CHANGES. No runtime defect; the round-1 findings were
  confirmed resolved apart from two wording points: the last table row said "neither sees the
  other's rows" although the test queries only as tenant A, and the PR summary counted seven
  replay snapshot comparisons where six are around a replay and the seventh is a first delivery
  that checks the other tenant's tasks. Both narrowed; no code or test change.
