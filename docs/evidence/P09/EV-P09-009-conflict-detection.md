# EV-P09-009: Conflict detection: deterministic hours overlap, faq duplicate candidates, suspension, resolution and reopening (ROUND-1 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-009 |
| Item | P09.07.04 |
| Date (UTC) | 2026-10-11 20:20 UTC (ROUND-1 fix; initial 20:00 UTC) |
| Commit | `TBD (this push)` — prior pin `77905c6` (superseded by ROUND-1) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T201116Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (23.3 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #102 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #102 after ROUND-1 fix) |
| Mutation | `mutation_check.py` KILLED at this HEAD (fix-paths conflicts.ts: semantic proof — without-fix run fails the reopen assertion `resolved then redetected reopens with a fresh open task`, not a missing file; with-fix PASS; byte-identical restore) |
| Design notes | ROUND-1 (codex BLOCK on 77905c6, lifecycle P1 + evidence): resolved + redetected is a NEW CYCLE — openConflict reopens the row (status open, cleared resolution/resolved_at, fresh detected_at, task_id NULL) so subjects suspend and the owner gets callback work; without it the row stays resolved while subjects suspend (silent dead content). Per-cycle task key conflict:r<epoch>:<pair-digest> (sha256 pair digest — bare uuids overflow the 100-char task key limit, caught by the suite). Tests 7 green 3x (23/23 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
