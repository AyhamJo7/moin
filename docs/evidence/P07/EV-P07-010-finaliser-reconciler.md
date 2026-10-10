# EV-P07-010: finaliser plus reconciler plus 11 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-010 |
| Item | P07.11.01 |
| Date (UTC) | 2026-10-10 22:22 UTC, round-1 fix 2026-10-11 ~00:35 UTC |
| Commit | round-1 fix head (this push) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261010T223339Z-full.json`, on this head); finaliser integration suite 11/11 green standalone; mutation-check KILLED on finaliser suite (initial commit) |
| Result | PASS |
| CI run / artifact | PR #89 (draft): initial head CI state at push time (see push report); this round-1 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `075e9a1` (3 findings, all fixed: closed-fallback repair mints a fresh follow-up task under a new random key with distinct follow_up type so the one-system-task-per-type unique holds alongside the closed row; orphan age clock is GREATEST(conversation, max call) so live call activity keeps the row out of the claim; onOrphan collected in-txn and delivered post-commit with per-callback try/catch counted as deliveryErrors, never rolling back persisted work) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/finaliser.integration.test.ts" --fix-paths packages/db/src/finaliser.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new DEFINER: a claim function over `conversations` cannot work tenant-less under FORCE RLS (SECURITY DEFINER changes who runs, not what the policy sees — verified by probe: same WHERE returns the row inside `withTenant`, nothing outside). The sweep pages tenants via reviewed `app.claim_audit_chains` and checks orphans per-tenant inside `withTenant`. Metric `interactions.orphaned` = report.orphaned; alarm wiring (log/metric/CloudWatch, 5-min schedule) is P08/P15 — the `onOrphan` callback and `orphanSeverity` helper are the contract. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
