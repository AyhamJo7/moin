# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-2 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 20:15 UTC (ROUND-2 fix; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `8eabdf3` (ROUND-2 fix incl. EV + ledger; prior pin `178f16f` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T180021Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (30.8 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-2 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-2 (codex BLOCK on 178f16f, 4 findings): P1-1 stale-task reuse — sweep key is now per-cycle reverify:item:version, so a re-approved version mints a FRESH open task even after the prior cycle's task completed; test completes the first task then asserts the second id is new + open. P1-2 sweep/approval race — suspend UPDATE is version-guarded (item + live_version match; 0 rows = approval won, skip); documented in code. P2-1 composite FK — FOREIGN KEY (org, task_id) → tasks(org, id) added in 0057 (UNIQUE since 0025 makes it expressible); bare-UUID claim removed; test pins 23503 on cross-tenant link. P2-2 FAQ sweep gap — sweepReverify now also sweeps overdue cards (task-only public/internal; sensitive deactivates via active=false mirroring suspension, re-activated by next update); faq.* audit keys added to allowlist; migration comment updated; card idempotency key reverify-card:id with repeat-sweep test. Tests 12 green 3x (34/34 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
