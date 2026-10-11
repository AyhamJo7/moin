# EV-P09-009: Conflict detection: deterministic hours overlap, faq duplicate candidates, suspension, resolution and reopening (ROUND-2 evidence refresh)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-009 |
| Item | P09.07.04 |
| Date (UTC) | 2026-10-11 20:35 UTC (ROUND-2 evidence-only; ROUND-1 20:20 UTC; initial 20:00 UTC) |
| Commit | `a208861` (ROUND-2 evidence-only incl. EV + ledger; code unchanged since `446d260`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T202548Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (22.1 s), migrations, build, licences, secret-scan. One transient telephony unit flake on the first full run (unrelated files, green standalone + on re-run). Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #102 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #102 after ROUND-2 evidence refresh) |
| Mutation | `mutation_check.py` KILLED at HEAD `446d260` (fix-ref `6d61c6b`, fix-paths conflicts.ts: without-fix run fails the reopen assertion `resolved then redetected reopens with a fresh open task`; with-fix PASS; byte-identical restore) |
| Design notes | ROUND-2 (codex BLOCK on 446d260, EVIDENCE ONLY — invariant/security/architecture OK, no implementation blockers): no code changes. Re-cited gates artifact ...202548Z recorded on HEAD 446d260 (matches_tree true) and re-ran mutation_check at current HEAD: KILLED with semantic proof on the reopen assertion. Full ROUND-1 design (reopen-as-new-cycle + digest task keys) unchanged — see prior record. Tests 7 green 3x (23/23 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
