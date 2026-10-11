# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-7 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 21:10 UTC (ROUND-7 fix; ROUND-6 21:00 UTC; ROUND-5 20:45 UTC; ROUND-4 20:35 UTC; ROUND-3 20:40 UTC; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `TBD (this push)` — prior pin `2b1bf7d` (superseded by ROUND-7) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T190525Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (31.0 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-7 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-7 (codex BLOCK on 2b1bf7d, 1 P1 + evidence-cite): locked re-read repeats the FULL eligibility predicate minus the queue leg (active + unexpired + still overdue; the queued leg stays on the anchor-carrying INSERT...SELECT, which skips on zero rows). FOR UPDATE cannot touch the nullable queue side of the outer join — first attempt failed loudly with that exact error, so the lock targets faq_cards alone by id and the queue conflict is caught at insert time; documented at the query. Item path needs no change: its version-guarded UPDATE already re-checks liveness at write time (audited, no gap). New test pins deactivated/refreshed cards invisible to the sweep while an overdue twin tasks normally. Evidence-cite fix: this record cites the artifact recorded on the pushed HEAD (matches_tree true). Tests 15 green 3x (37/37 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
