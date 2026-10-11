# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-7 evidence refresh)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 23:35 UTC (ROUND-7 evidence-only; ROUND-6 23:20 UTC; ROUND-5 23:00 UTC; ROUND-4 22:45 UTC; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `TBD (this push)` — code unchanged since `6882025` (evidence-only update) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T224553Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (26.1 s), migrations, build, licences, secret-scan. One transient readiness unit flake on the first full run (unrelated files, green standalone + on re-run). Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-7 evidence refresh) |
| Mutation | Semantic KILLED at HEAD `6882025` (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 14 pass; restored byte-identical). |
| Design notes | ROUND-7 (codex BLOCK on 6882025, EVIDENCE ONLY — invariant/security/architecture OK, no implementation blockers): no code changes. Re-cited gates artifact ...223451Z recorded on HEAD 6882025 (matches_tree true) and re-ran the semantic mutation at current HEAD: KILLED. Full ROUND-6 design (client-side endReceived + server-barrier removal) unchanged — see prior record. Tests 17 green 3x (33/33 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
