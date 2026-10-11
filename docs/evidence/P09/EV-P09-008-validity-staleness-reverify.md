# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-3 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 20:40 UTC (ROUND-3 fix; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `TBD (this push)` — prior pin `3480f2e` (superseded by ROUND-3) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T181428Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (28.3 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-3 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-3 (codex BLOCK on 3480f2e, 4 findings): P1-1 FAQ reactivation — updateFaqCard sets active=true (any owner edit re-arms, the re-approval equivalent) + deletes the card queue row (mirrors approval-clears-queue); test pins update → active + served + queue cleared. P1-2 card convergence — queue gains nullable card_id with exactly-one-of(item,card) CHECK + per-subject UNIQUEs (separate FK legs to items/cards; task FK shared); sweep excludes handled cards, per-cycle key reverify-card:id:updated-epoch; repeat sweep asserts tasksCreated=0; card update re-arms for the next cycle. P2-1 FK syntax — ON DELETE SET NULL (task_id) column list per 0041/0042 precedent. P2-2 double suspend — guarded UPDATE adds AND not suspended (0 rows when a concurrent sweep or approval already handled it → skip side effects). Inventory row for card_id. Tests 12 green 3x (34/34 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
