# EV-P07-010: finaliser plus reconciler plus 13 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-010 |
| Item | P07.11.01 |
| Date (UTC) | 2026-10-10 22:22 UTC, round-1 fix 2026-10-11 ~00:35 UTC, round-2 fix 2026-10-11 ~00:50 UTC, round-3 fix 2026-10-11 ~01:05 UTC |
| Commit | `44b3e43c1966fe0299f791b7d57fdd864b8e37ca` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T225918Z-full.json`, on this head); finaliser integration suite 13/13 green standalone; mutation-check KILLED on finaliser suite (initial commit) |
| Result | PASS |
| CI run / artifact | PR #89 (draft): earlier heads CI state at push time (see push reports); this round-3 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `075e9a1` (3 findings, fixed); codex BLOCK round 2 on `5df59dc` (3 residuals, fixed); codex BLOCK round 3 on `77eef85` (3 residuals, all fixed: done→reopen same row, cancelled→general-type replacement outside the partial unique with repeat-cancel test; fresh-event test ages-then-events with claimed-before sanity; finalised++ moved to post-commit merge with counter-vs-persisted assertion) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/finaliser.integration.test.ts" --fix-paths packages/db/src/finaliser.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new DEFINER: a claim function over `conversations` cannot work tenant-less under FORCE RLS (SECURITY DEFINER changes who runs, not what the policy sees — verified by probe: same WHERE returns the row inside `withTenant`, nothing outside). The sweep pages tenants via reviewed `app.claim_audit_chains` and checks orphans per-tenant inside `withTenant`. Metric `interactions.orphaned` = report.orphaned; alarm wiring (log/metric/CloudWatch, 5-min schedule) is P08/P15 — the `onOrphan` callback and `orphanSeverity` helper are the contract. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
