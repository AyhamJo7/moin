# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-6 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 21:00 UTC (ROUND-6 fix; ROUND-5 20:45 UTC; ROUND-4 20:35 UTC; ROUND-3 20:40 UTC; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `TBD (this push)` — prior pin `26a50ac` (superseded by ROUND-6) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T185250Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (28.8 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-6 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-6 (codex BLOCK on 26a50ac, 1 P1 + evidence-cite): overlapping-statement race on the public card path — the candidate select now re-reads card rows FOR UPDATE by id in id order (FOR UPDATE cannot touch the nullable queue side of the outer join, hence the two-step: lock-free candidate select, then locked re-read). The lock is held for the sweep txn, so a concurrent updateFaqCard blocks until commit/abort and the anchor-carrying INSERT...SELECT reads COMMITTED updated_at — serializes exactly like the sensitive path. Lock order single-table id-ordered, no deadlock cycle; documented at the select. New concurrent-sweeps test pins the observable contract (both sweeps succeed, one queue row + task total, zero new work + zero new audit on repeat). Evidence-cite fix: this record cites the artifact recorded on the pushed HEAD (matches_tree true). Tests 14 green 3x (36/36 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
