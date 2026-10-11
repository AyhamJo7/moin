# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-6 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 23:20 UTC (ROUND-6 fix; ROUND-5 23:00 UTC; ROUND-4 22:45 UTC; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `86b3c6e` (ROUND-6 fix incl. EV + ledger; prior pin `eb80038` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T223236Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (25.2 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-6 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 14 pass; restored byte-identical). |
| Design notes | ROUND-6 (codex BLOCK on eb80038, client-side barrier P1 + evidence): GuardedResponse gains test-only endReceived (resolves on the connector's first finish — success or failure). The truncation proof awaits endReceived BEFORE its first read, so post-end-drain ordering holds on the CONNECTOR's response-'end' observation — not the server res.end callback (kernel-accepted bytes can still be draining client-side, and the connector pauses the stream). Server barrier removed (ack counter gone); production streams headers-immediately, unchanged. Tests 17 green 3x (33/33 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
