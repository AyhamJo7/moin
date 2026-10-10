# EV-P07-010: finaliser plus reconciler plus 12 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-010 |
| Item | P07.11.01 |
| Date (UTC) | 2026-10-10 22:22 UTC, round-1 fix 2026-10-11 ~00:35 UTC, round-2 fix 2026-10-11 ~00:50 UTC |
| Commit | round-2 fix head (this push) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T224627Z-full.json`, on this head); finaliser integration suite 12/12 green standalone; mutation-check KILLED on finaliser suite (initial commit) |
| Result | PASS |
| CI run / artifact | PR #89 (draft): earlier heads CI state at push time (see push reports); this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `075e9a1` (3 findings, fixed); codex BLOCK round 2 on `5df59dc` (3 residuals, all fixed: closed-fallback repair is reopenTask done→open on the same row — zero row growth, zero 23505, cancelled throws rather than covering silently; orphan age clock is GREATEST(conversation, max call, max event) so bare events keep the row out; per-tenant orphans collected in a withTenant-returned local array and merged post-commit, so a rolled-back tenant contributes nothing) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/finaliser.integration.test.ts" --fix-paths packages/db/src/finaliser.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new DEFINER: a claim function over `conversations` cannot work tenant-less under FORCE RLS (SECURITY DEFINER changes who runs, not what the policy sees — verified by probe: same WHERE returns the row inside `withTenant`, nothing outside). The sweep pages tenants via reviewed `app.claim_audit_chains` and checks orphans per-tenant inside `withTenant`. Metric `interactions.orphaned` = report.orphaned; alarm wiring (log/metric/CloudWatch, 5-min schedule) is P08/P15 — the `onOrphan` callback and `orphanSeverity` helper are the contract. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
