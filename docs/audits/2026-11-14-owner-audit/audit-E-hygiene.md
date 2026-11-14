# Audit E: git / GitHub hygiene, AyhamJo7/moin

Read-only. Collected 2026-11-13/14 from `/home/adam/projects/business/moin`. Local `main` = `origin/main` = `0e020d2`.
No `git fetch` was run (it writes refs); remote-tracking refs are as last fetched. The 13 open PR head SHAs from `gh` match the local `origin/*` refs.
`/verify-report` was not run; every CI/PR claim below is from a `gh` command in this session (section 8). Counts were not recounted by `inventory-checker`.

## 1. Open PRs (13)

All 13: draft, `mergeable=MERGEABLE`, 0 behind main, no GitHub reviews, no PR comments, `reviewDecision` empty.
Every PR body says "Independent review pending; nothing here is VERIFIED".
CI ran on the listed head SHA; 21 checks each. All green except #270.

| PR  | Head branch                              | Base            | Head SHA | Ahead              | Files | CI on head                                                            | Merge state |
| --- | ---------------------------------------- | --------------- | -------- | ------------------ | ----- | --------------------------------------------------------------------- | ----------- |
| 257 | docs/p04-rerun-evidence                  | main            | d89cc2c  | 5                  | 11    | 21/21 pass                                                            | CLEAN       |
| 259 | fix/p06-13-route-coverage-production-app | main            | 37302ec  | 9                  | 23    | 21/21 pass                                                            | CLEAN       |
| 260 | test/p06-invitation-lock-timing          | main            | b4fb416  | 4                  | 8     | 21/21 pass                                                            | CLEAN       |
| 261 | docs/p06-acceptance-groups-7-12          | main            | 0c076c5  | 5                  | 19    | 21/21 pass                                                            | CLEAN       |
| 262 | fix/p06-07-invite-role-ceiling           | main            | ea044af  | 6                  | 15    | 22/22 pass (pr-title twice)                                           | CLEAN       |
| 263 | fix/p06-07-ownership-lock-order          | main            | 5a1196d  | 3                  | 10    | 21/21 pass                                                            | CLEAN       |
| 264 | fix/p06-07-accept-grantor-lock           | **#262 branch** | 1b3b592  | 8 vs main (2 own)  | 8     | 21/21 pass                                                            | CLEAN       |
| 265 | fix/p06-11-support-grant-integrity       | main            | 9a2fae8  | 2                  | 9     | 21/21 pass                                                            | CLEAN       |
| 266 | fix/p06-06-csrf-session-binding          | main            | d162871  | 3                  | 11    | 21/21 pass                                                            | CLEAN       |
| 267 | fix/p06-12-throttle-bounds               | main            | d2ffe23  | 3                  | 18    | 21/21 pass                                                            | CLEAN       |
| 268 | fix/p06-07-route-matrix-generated        | **#259 branch** | f6e01b3  | 11 vs main (2 own) | 10    | 21/21 pass                                                            | CLEAN       |
| 269 | fix/p06-04-early-access-override-audit   | main            | 7fa2fed  | 4                  | 11    | 21/21 pass                                                            | CLEAN       |
| 270 | fix/p02-server-image-all-roles           | main            | 855ce19  | 2                  | 8     | **19/21: `semgrep, actionlint, shellcheck` and `security-scan` FAIL** | **BLOCKED** |

### What each touches

| PR  | Scope                                 | Control path?                                                  | Notable files                                                      | Findings recorded in the PR body                                                                      |
| --- | ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 257 | docs only                             | no                                                             | PLAN.md, PROGRESS.md, INDEX.md, docs/audits, 7 EV-P04              | re-proves seven P04 items                                                                             |
| 259 | xsuite tests + CI workflow            | CI config (`.github/workflows/verify.yml`), cross-tenant suite | modules/xsuite/*, verify.yml                                       | closes 1 HIGH + 2 MEDIUM of the group 12 review; L1 to L4 left open                                   |
| 260 | one test file + evidence              | test under identity-access                                     | members.integration.test.ts                                        | fixes the invitation lock timing flake                                                                |
| 261 | docs only                             | no (ledger, ADR-0046)                                          | PLAN.md, PROGRESS.md, docs/audits g07 to g12, ADR                  | lowers status for six items; two delegated decisions                                                  |
| 262 | identity code + migration             | **yes**: authz, migration 0079, check-rls-catalog.ts           | invitations.ts, roles.ts, members.controller.ts                    | review round 1: two MEDIUM; `gates.py full` PASS 14/14 at 6049c22 on the third run; re-review pending |
| 263 | identity code                         | **yes**: ownership lock order                                  | members.controller.ts, recovery.controller.ts, member-queries.ts   | from g09 M2 + L1                                                                                      |
| 264 | migration + test                      | **yes**: migration 0081, check-rls-catalog.ts                  | 0081_accept_invitation_grantor_lock.sql                            | fixes a MEDIUM from round 2 of #262; relies on #263's lock order                                      |
| 265 | support code + migration              | **yes**: grants, audit, migration 0080                         | support.controller.ts, 0080_support_grant_integrity.sql            | g10 M1 to M4; "each becomes HIGH" once support reads are executable                                   |
| 266 | auth/session code                     | **yes**: CSRF, session guard                                   | csrf.ts, auth.controller.ts, session-membership.guard.ts           | g07 M1, L1, L2; chose not to use a server-keyed MAC                                                   |
| 267 | auth code + migration                 | **yes**: throttle, migration 0082                              | auth-throttle.guard.ts, auth.controller.ts, recovery.controller.ts | g11 M1, M3, M4, L1                                                                                    |
| 268 | RBAC route matrix tests + policy file | RBAC test/policy                                               | roots/route-policy.ts, xsuite/root-routes.ts                       | g09 M4                                                                                                |
| 269 | migration + docs                      | **yes**: migration 0083, SECURITY DEFINER allowlist doc        | 0083_cap_override_audit.sql                                        | P06.04.03 MEDIUM F1                                                                                   |
| 270 | image build + CI                      | build/CI (`Dockerfile`, `container-scan.yml`, `scripts/`)      | apps/server/Dockerfile, scripts/workspace-closure.ts               | arm64 build and container-scan "not verified"                                                         |

### Overlaps that force serial rebases

- **Every PR appends to `PROGRESS.md` and `docs/evidence/INDEX.md`.** `MERGEABLE` holds only against today's main; after each squash-merge the rest will most likely conflict there. No `.gitattributes` on main, so no union merge driver.
- `scripts/check-rls-catalog.ts`: #262, #264, #265, #267, #269.
- `members.integration.test.ts`: #260, #262, #263, #264. `members.controller.ts`: #262, #263.
- `auth.controller.ts`, `session-membership.integration.test.ts`: #266, #267. `recovery.controller.ts` + its test: #263, #267.
- `xsuite/cross-tenant.integration.test.ts`: #259, #266. `xsuite/root-routes.ts`: #259, #268.
- `PLAN.md`: #257, #261.
- Migrations: main ends at 0078. 0079 (#262), 0080 (#265), 0081 (#264), 0082 (#267), 0083 (#269). Merge in number order.

### Recommendations

| PR   | Recommendation           | Reason                                                                                                                         |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 257  | MERGE NOW (after review) | docs only, green, clean; first in the queue                                                                                    |
| 260  | MERGE NOW (after review) | test only; removes a known flake that hit #262's gates                                                                         |
| 261  | REBASE THEN MERGE        | docs only; conflicts with #257 on PLAN.md / PROGRESS.md / INDEX.md                                                             |
| 259  | REBASE THEN MERGE        | green; founder-merged (`.github/`); parent of #268                                                                             |
| 268  | REBASE THEN MERGE        | retarget to main after #259 is squash-merged (needs `rebase --onto`)                                                           |
| 262  | REBASE THEN MERGE        | re-review of the two round 1 MEDIUM fixes is still pending; founder-merged                                                     |
| 263  | REBASE THEN MERGE        | founder-merged; must land before #264                                                                                          |
| 265  | REBASE THEN MERGE        | migration 0080; founder-merged                                                                                                 |
| 264  | REBASE THEN MERGE        | retarget to main after #262; needs #263 too; migration 0081                                                                    |
| 266  | REBASE THEN MERGE        | founder-merged (session code)                                                                                                  |
| 267  | REBASE THEN MERGE        | migration 0082; overlaps #266                                                                                                  |
| 269  | REBASE THEN MERGE        | migration 0083; founder-merged                                                                                                 |
| 270  | **NEEDS FIX**            | shellcheck SC2317 at `scripts/check-server-image-roles.sh` lines 20, 21, 23 fails the required `security-scan`; founder-merged |
| none | CLOSE                    | nothing is superseded or duplicated                                                                                            |

No PR has a review recorded, so none passes the repo's own merge rule yet (`merge_gate.py` runs the independent review). "MERGE NOW" means: no rebase or fix needed first.

### Safe merge order

0. **Fix the image CVE on main first** (section 4). Every rebase re-triggers `container-scan`, which now fails on main's Dockerfile.
1. #257
2. #260
3. #261
4. #259
5. #268 (retarget to main)
6. #262 (0079)
7. #263
8. #265 (0080)
9. #264 (0081, retarget to main)
10. #266
11. #267 (0082)
12. #269 (0083)
13. #270 once shellcheck passes; it can go in at step 0 if the CVE fix is folded into it.

Founder-merged under the trial rule (until 2026-11-29): #259, #262 to #267, #269, #270, probably #268. Session-mergeable candidates: #257, #261, possibly #260 (the test sits under an identity path; the merge-gate globs decide).

## 2. Branches

### Remote (260 branches + `origin/main`)

| Class                                    | Count | Notes                                                                                                        |
| ---------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| Open PR                                  | 13    | the 13 heads above                                                                                           |
| Merged PR, ancestor of main              | 4     | chore/p02-02-qg01-gates, chore/p04-11-stack-integration, chore/p04-qg-gates-final, feat/p04-04-voice-adapter |
| Closed-unmerged PR, but ancestor of main | 1     | chore/p00-02-evidence-bookkeeping (#17 CLOSED; content is in main)                                           |
| Merged PR (squash), not an ancestor      | 242   | name-matched against `gh pr list --state all --limit 300`                                                    |
| No PR                                    | 0     |                                                                                                              |

- **Safe to delete (remote): 247**, with two that carry one docs commit pushed after the merge:
  - `origin/feat/p09-09-retrieval` f5b1145 "docs: BLOCKER row" (PROGRESS.md, +1 line); PR #104 merged at 82b1c55.
  - `origin/fix/qg09-s2-lock-order` 934691c "EV-P06-079 records PR 70 CI 16/16 green" (3 lines in the EV file); PR #70 merged at 6147bc8.
    Check those two lines are on main, or accept the loss, before deleting.
- **Unmerged work (remote): 13**, all open PRs.
- 12 early branches (P02/P03, Sept 28 to 29) differ from their PR head only by stack merge commits ("Merge pull request #N"); sampled two, no stray work.
- `feat/p07-gate-closeout`: #94 closed, #95 merged from the same head ab4f924; merged.
- Closed-unmerged PRs whose branches are already gone: #20 to #24 (negative controls, gitleaks rule).

### Local (25 branches + main)

| Branch                                     | PR                | Unique vs main                                                                                                                        | Class                                     |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| backup/p06-10-audit-pre-normalize-20260930 | none, no upstream | 7 commits (pre-normalisation history of P06.04/P06.10 audit work)                                                                     | **unmerged, keep until founder decides**  |
| docs/cp-0006-fixture-copy-revision         | none, no upstream | 1 commit (revision of patch 0006 doc)                                                                                                 | **unmerged**, probably superseded by #228 |
| chore/control-plane-autonomy               | #246 merged       | **1 unpushed commit** 79f67aa "let sessions merge after an automated review"; differs from main in `merge_gate.py`, `merge-gate.json` | **hold**: confirm superseded by #247      |
| docs/ledger-status-correction              | none              | 0 (ancestor of main, at 6e0f156)                                                                                                      | deletable; its worktree is dirty          |
| 21 others                                  | merged            | squash-merged                                                                                                                         | deletable                                 |

The 21: chore/control-plane-0008, ci/p02-05-fullstack-browser-acceptance, ci/p02-06-deterministic-hooks, ci/p02-06-semgrep-codeql, docs/m00-truth-reconciliation, docs/p13-01-ux01-gate0-design, feat/p02-demo-packaged-stack, feat/p08-05-worker-runtime, feat/p12-callback-reason-titles, feat/p13-02-heute-live-updates, feat/p13-02-today-callback-slice, feat/p13-03-owner-completes-callback, fix/next-16-4-1, fix/p12-12-callback-replay-integrity, fix/p12-historical-callback-carrier, fix/p12-task-audit-lock-order, fix/p13-today-contract-compat, hardening/control-plane-fixture-copy-0006, test/p06-12-throttle-bounds, test/p11-telephony-signature-tamper, test/p13-01-dg10-owner-prototype.

- **Safe to delete (local): 22.** Six are checked out in worktrees; the worktree goes first.
- **Hold (local): 3.**
- No local branch exists for any of the 13 open PRs.

## 3. Worktrees and stashes

Dirtiness could not be read with `git status` (no `git -C`). Method used: files newer than the worktree's index, plus a blob hash comparison where a tracked file showed up. "No evidence" is not proof of clean.

| Worktree (`/home/adam/worktrees/moin/…`) | Branch                        | PR          | Size | Dirty?                                                            |
| ---------------------------------------- | ----------------------------- | ----------- | ---- | ----------------------------------------------------------------- |
| chore-control-plane-autonomy             | chore/control-plane-autonomy  | #246 merged | 18M  | no evidence; **branch has 1 unpushed commit**                     |
| ci-p02-06-deterministic-hooks            | ci/p02-06-deterministic-hooks | #234 merged | 585M | no evidence                                                       |
| ci-p02-06-semgrep-codeql                 | ci/p02-06-semgrep-codeql      | #235 merged | 32M  | no evidence                                                       |
| docs-ledger-status-correction            | docs/ledger-status-correction | none        | 40M  | **DIRTY**: `PROGRESS.md` blob 7d529a1 differs from HEAD's 4a19566 |
| feat-p08-05-worker-runtime               | feat/p08-05-worker-runtime    | #245 merged | 159M | no evidence (cache file only)                                     |
| fix-next-16-4-1                          | fix/next-16-4-1               | #248 merged | 562M | no evidence                                                       |
| test-p06-12-throttle-bounds              | test/p06-12-throttle-bounds   | #236 merged | 33M  | no evidence (cache files only)                                    |

Total about 1.4 GB. Local heads of four of these are behind their remotes (stale, nothing lost).

`.claude/worktrees/`: one leftover directory, `feat-p33-sellgate`, 32K, **owned by root**, not a registered worktree. It holds only `docker/{postgres/init,keycloak/realm-moin-local.json,elasticmq/elasticmq.conf}`, which looks like bind-mount residue. Removing it needs sudo (founder). It is small, so the disk hazard from the control-plane gate copy is not active.

### Stashes (26, all from branches whose PRs are merged; newest 2026-10-15)

| Stash    | Branch                         | Content                                                             |
| -------- | ------------------------------ | ------------------------------------------------------------------- |
| 0        | feat/p20-booking               | 0076_slot_exclude.sql, booking.ts + tests, PROGRESS (173+/18-)      |
| 1        | feat/p09-0904-passages         | 0074_passages.sql, passages.ts + tests (199+/6-)                    |
| 2        | feat/p13-01-shell              | untracked only: apps/web/lib/i18n.ts + test, messages/de.json       |
| 3        | feat/p06-13-xsuite             | `.claude/hooks/policy_guard.py`, control-plane test, PROGRESS       |
| 4        | feat/p09-11-evalset            | `.claude/tests/test_control_plane.py`                               |
| 5        | feat/p07-04-merge              | untracked only: 0049_merge_ledger.sql (135 lines)                   |
| 6        | fix/qg09-s4-lifecycle          | session-mutation-manifest.json                                      |
| 7        | fix/qg09-s2-lock-order         | check-rls-catalog.ts (2 lines)                                      |
| 8        | feat/p06-13-xsuite             | INDEX.md, one row                                                   |
| 9        | feat/p06-13-xsuite             | `.claude/hooks/policy_guard.py`                                     |
| 10 to 12 | feat/p06-10-03-adoption        | direct edits to 0018_invitations.sql (superseded by 0021), one test |
| 13 to 16 | feat/p06-06-step-up-mfa        | sweep reports, manifest, 155-line session-membership test WIP       |
| 17 to 19 | feat/p06-06-membership-recheck | sweep report, PROGRESS blocker rows                                 |
| 20 to 24 | feat/p06-06-session-foundation | PROGRESS blocker rows, sweep reports                                |
| 25       | chore/p02-02-toolchain         | prettier reformat of 23 founder-only `.claude/` files               |

Stashes 3, 4, 9 and 25 contain edits to guardrail files; they must not be popped by a session. All 26 look superseded by merged work; dropping them is a founder call.

## 4. CI health

### main at 0e020d2

| Trigger                  | verify  | security-scan | codeql          | container-scan    |
| ------------------------ | ------- | ------------- | --------------- | ----------------- |
| push, 2026-11-01         | success | success       | success         | success           |
| schedule, 11-04          | n/a     | success       | n/a             | success           |
| schedule, 11-05 to 11-13 | n/a     | success (9/9) | success (11-09) | **failure (9/9)** |

**Main's scheduled `container-scan` has failed nine days in a row.** Job `hadolint, build, trivy image`, step `Trivy image scan`: `Total: 2 (HIGH: 2, CRITICAL: 0)`, `apt` 2.6.1, CVE-2026-109518, fixed in 2.6.2. The code did not change; the advisory is new. The base image needs a bump or an `apt` upgrade. No open PR addresses it (#270 changes the Dockerfile but its scan passed on 11-03, before the advisory).

### Last 60 runs (2026-11-03 to 11-13)

| Workflow           | Runs | Failures                | Rate |
| ------------------ | ---- | ----------------------- | ---- |
| container-scan     | 17   | 9 (all scheduled, main) | 53%  |
| security-scan      | 16   | 1 (#270, shellcheck)    | 6%   |
| codeql             | 8    | 0                       | 0%   |
| review-annotations | 7    | 0                       | 0%   |
| verify             | 6    | 0                       | 0%   |
| pr-title           | 6    | 0                       | 0%   |

### Latest failures

| Run         | Workflow                  | SHA     | Job / step                                      | Cause                                                                           |
| ----------- | ------------------------- | ------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| 43426606550 | container-scan (schedule) | 0e020d2 | hadolint, build, trivy image / Trivy image scan | apt CVE-2026-109518 HIGH                                                        |
| 41672360032 | security-scan (PR #270)   | 855ce19 | semgrep, actionlint, shellcheck / shellcheck    | SC2317 (info) in `scripts/check-server-image-roles.sh` lines 20, 21, 23; exit 1 |

### Flakiness

- No successful run among the last 100 has `run_attempt > 1`. No same-SHA fail-then-pass pair in the listing.
- One flake is on record in a PR body, not in CI: the invitation lock timing case in `members.integration.test.ts` made #262's local gates fail once; #260 fixes it.
- Earlier red stretch: scheduled `container-scan` and `security-scan` both failed daily on main 6e0f156 from 10-23 to 10-31, and went green after the 11-01 merges. Cause not inspected.
- `pr-title` failures in October were each followed by a new SHA (text fixes), not re-runs.

## 5. Issues, dependency bots, alerts

| Item                   | State                                              |
| ---------------------- | -------------------------------------------------- |
| Open issues            | 0                                                  |
| Dependabot alerts      | disabled for the repository (HTTP 403)             |
| Dependabot PRs         | none open                                          |
| Renovate PRs           | none open (all 13 open PRs are hand-made branches) |
| Code scanning (CodeQL) | **10 open, all severity `warning`**                |

| #     | Rule                         | File                                                         |
| ----- | ---------------------------- | ------------------------------------------------------------ |
| 9, 10 | js/remote-property-injection | apps/server/src/modules/voice/http/twilio-signature.guard.ts |
| 6, 7  | js/incomplete-sanitization   | scripts/mutation-sweep.ts                                    |
| 8     | js/file-system-race          | scripts/mutation-sweep.ts                                    |
| 5     | js/double-escaping           | packages/db/src/import.ts                                    |
| 2     | js/polynomial-redos          | packages/db/src/import.ts                                    |
| 1     | js/polynomial-redos          | packages/ai/src/gateway/openai.ts                            |
| 3     | js/polynomial-redos          | packages/kernel/src/spoken-lint.ts                           |
| 4     | js/polynomial-redos          | packages/testing/src/pg/template.ts                          |

Alerts 9 and 10 sit on the Twilio webhook signature guard, a control path; worth a triage.
With Dependabot alerts off, dependency CVEs are caught only by the scheduled `security-scan` and `container-scan`.

## 6. Markers and skipped tests (apps/, packages/, scripts/ on main)

| Check                                                                                  | Result                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TODO / FIXME / HACK / XXX                                                              | **0 real markers.** Two case-insensitive hits are data: `scripts/check-slice-report.ts:47` (a list of forbidden annotations) and `packages/config/src/eslint/rules/no-tenant-conditional.test.ts:48` (a `hack()` call in a lint fixture) |
| `it.skip` / `describe.skip` / `test.skip` / `.todo` / `xit`                            | **0 in test code.** `scripts/__fixtures__/slice-report/` uses `test.skip()` on purpose as a negative control                                                                                                                             |
| `.only(` / `.fails(`                                                                   | 0                                                                                                                                                                                                                                        |
| Conditional suite                                                                      | `packages/telephony/test-support/fixed-auth-token.test.ts:13`: `describe.runIf(process.env['FIXED_AUTH_TOKEN_RUN'] === '1')`, so it does not run by default                                                                              |
| Suppression comments (`eslint-disable`, `@ts-expect-error`, `@ts-ignore`, `nosemgrep`) | present in about 30 files; highest count `scripts/check-rls-catalog.integration.test.ts` (20). Not triaged                                                                                                                               |

## 7. Broken or risky, in order

1. Main's `container-scan` is red (apt CVE-2026-109518); any rebased PR will inherit the failure.
2. #270 is blocked by shellcheck SC2317.
3. Thirteen drafts with no recorded review; ten touch control paths; five add migrations 0079 to 0083 that must merge in order; all thirteen collide on PROGRESS.md and INDEX.md.
4. #264 and #268 are stacked; squash-merging the parent requires a retarget and `rebase --onto`.
5. `docs-ledger-status-correction` worktree has an uncommitted PROGRESS.md on a branch with no PR.
6. `chore/control-plane-autonomy` holds one unpushed commit touching guardrail files.
7. 247 stale remote branches, 22 stale local branches, 26 stashes, about 1.4 GB of worktrees.
8. Root-owned leftover at `.claude/worktrees/feat-p33-sellgate`.
9. Ten open CodeQL warnings; Dependabot alerts disabled.

## 8. Evidence

| Claim                         | Command                                                  | SHA                    | Status                                 |
| ----------------------------- | -------------------------------------------------------- | ---------------------- | -------------------------------------- |
| main CI on push               | `gh run list --branch main --event push --limit 12`      | 0e020d2                | RUN+PASSED (4/4)                       |
| main scheduled container-scan | `gh run list --limit 60`; job log 131889437350           | 0e020d2                | RUN+FAILED                             |
| PR check status               | `gh pr view <n> --json statusCheckRollup` for each of 13 | head SHAs in section 1 | RUN+PASSED for 12; RUN+FAILED for #270 |
| #270 failure cause            | job log 126043780870                                     | 855ce19                | RUN+FAILED (shellcheck)                |
| Local gates (`gates.py`)      | none                                                     | n/a                    | NOT RUN                                |
| Pairwise merge conflicts      | none (inferred from file overlap)                        | n/a                    | NOT RUN                                |
| Worktree `git status`         | none (heuristic only)                                    | n/a                    | NOT RUN                                |
