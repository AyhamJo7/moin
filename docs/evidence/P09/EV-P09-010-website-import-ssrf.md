# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-5 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 23:00 UTC (ROUND-5 fix; ROUND-4 22:45 UTC; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `TBD (this push)` — prior pin `b9cd457` (superseded by ROUND-5) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T222217Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (24.8 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-5 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 14 pass; restored byte-identical). |
| Design notes | ROUND-5 (codex BLOCK on b9cd457, determinism P1 + evidence): the end-gate is a SERVER barrier, not a connector option — res.end's callback increments an ack counter, and the test polls until BOTH requests' ends fired BEFORE draining the small body, so end-before-drain ordering is guaranteed (no race between headers-immediate resolve and first read). Determinism comes from the server barrier, production keeps headers-immediate streaming (no connector change needed beyond ROUND-4). Tests 17 green 3x (33/33 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
