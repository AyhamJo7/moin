# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-5 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 20:45 UTC (ROUND-5 fix; ROUND-4 20:35 UTC; ROUND-3 20:40 UTC; ROUND-2 20:15 UTC; ROUND-1 19:40 UTC; initial 17:29 UTC) |
| Commit | `1587ce1` (ROUND-5 fix incl. EV + ledger; prior pin `6c1c412` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T183952Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (25.6 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-5 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-5 (codex BLOCK on 6c1c412, 1 P1 + evidence-cite): public/internal card queue insert now carries the updated_at anchor (INSERT ... SELECT ... WHERE updated_at = anchor) — an owner update committing between select and insert wins with zero rows (skip task + audit) instead of the sweep re-planting a STALE row that suppresses the next cycle; sweep-vs-sweep stays first-writer-wins via the same check. New test pins the interleave deterministically (backdate → owner update → sweep at fresh instant queues nothing, serves fresh). Evidence-cite fix: this record cites the artifact recorded on the pushed HEAD (matches_tree true). Tests 13 green 3x (35/35 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
