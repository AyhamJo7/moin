# EV-P07-010: finaliser plus reconciler plus 14 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-010 |
| Item | P07.11.01 |
| Date (UTC) | 2026-10-10 22:22 UTC, round-1 fix 2026-10-11 ~00:35 UTC, round-2 fix 2026-10-11 ~00:50 UTC, round-3 fix 2026-10-11 ~01:05 UTC, round-4 fix 2026-10-11 ~01:15 UTC |
| Commit | `eb2896ca16fbfff9181e3dac226f7c71d8a8262b` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T231121Z-full.json`, on this head); finaliser integration suite 14/14 green standalone; mutation-check KILLED on finaliser suite (initial commit) |
| Result | PASS |
| CI run / artifact | PR #89 (draft): earlier heads CI state at push time (see push reports); this round-4 fix head CI pending at push time |
| Reviewer | codex BLOCK rounds 1–3 (fixed); codex BLOCK round 4 on `eab0284` (2 residuals, both fixed: cancelled-repair serialised on the deterministic row lock with loser re-check → task-existed, concurrent-repair convergence test; per-tenant claim exported as orphanConversations and fresh-event test reads it directly with zero task side-effects either side) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/finaliser.integration.test.ts" --fix-paths packages/db/src/finaliser.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new DEFINER: a claim function over `conversations` cannot work tenant-less under FORCE RLS (SECURITY DEFINER changes who runs, not what the policy sees — verified by probe: same WHERE returns the row inside `withTenant`, nothing outside). The sweep pages tenants via reviewed `app.claim_audit_chains` and checks orphans per-tenant inside `withTenant`. Metric `interactions.orphaned` = report.orphaned; alarm wiring (log/metric/CloudWatch, 5-min schedule) is P08/P15 — the `onOrphan` callback and `orphanSeverity` helper are the contract. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
