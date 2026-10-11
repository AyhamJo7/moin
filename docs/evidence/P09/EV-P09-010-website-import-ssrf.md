# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-2 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 22:00 UTC (ROUND-2 fix; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `TBD (this push)` — prior pin `f35357b` (superseded by ROUND-2) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T213518Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (24.4 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-2 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 13 pass; restored byte-identical). |
| Design notes | ROUND-2 (codex BLOCK on f35357b, pin-not-connected P1 + robots buffering + evidence): the pin is now BOUND to the transport — FetchImpl carries pinnedAddress, both page and robots call sites pass the resolvePinned result, and the production fetchPinned connector dials host=pinned with servername=hostname (TLS validates the hostname cert, socket goes to the checked IP, no second resolution). New test pins dialled === checked on every call (robots + page). Robots body stream-capped like pages (32 KiB WHILE reading; stub shape falls back to text()). Tests 16 green 3x (32/32 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
