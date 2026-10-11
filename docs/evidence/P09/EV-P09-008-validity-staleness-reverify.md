# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-9 evidence refresh)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 21:35 UTC (ROUND-9 evidence-only; ROUND-8 21:25 UTC; ROUND-7 21:10 UTC; ROUND-6 21:00 UTC; ROUND-5 20:45 UTC; ROUND-4 20:35 UTC; ROUND-3 20:40 UTC; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `TBD (this push)` — prior pin `ca4854a` (code unchanged since; evidence-only update) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T192947Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (29.6 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-9 evidence refresh) |
| Mutation | `mutation_check.py` KILLED at HEAD `36cfe7a` (fix-ref `ca4854a`, fix-paths staleness.ts: staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-9 (codex BLOCK on 36cfe7a, EVIDENCE ONLY — invariant/security/architecture OK, no implementation blockers): no code changes. Re-cited gates artifact ...192129Z recorded on HEAD 36cfe7a (matches_tree true) and re-ran mutation_check against the round-8 fix commit at current HEAD: KILLED. Full ROUND-8 design (lockEligibleCards seam + two-phase interleave proof; item path needs no seam) unchanged — see prior record. Tests 16 green 3x (38/38 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
