# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-3 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 22:30 UTC (ROUND-3 fix; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `TBD (this push)` — prior pin `4cd4947` (superseded by ROUND-3) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T215916Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (24.4 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-3 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 14 pass; restored byte-identical). |
| Design notes | ROUND-3 (codex BLOCK on 4cd4947, connector buffering P1 + evidence): caps enforced INSIDE the production connector — response stream consumed chunk-by-chunk against a running total with socket destroy past the cap (maxBytes rides the init: page cap vs 32 KiB robots); resolved GuardedResponse always carries a live stream (never buffered text + null body); readCappedBody re-checks as second layer; text() fallback gated to stub-only. Backpressure via inbound pause/resume (memory O(one chunk)). Local-server proof: oversize aborts too-large WITHOUT holding the body, small body byte-identical, Host = original hostname asserted after close (never thrown in-handler). Caller-Host-wins header merge (literal-IP test URLs keep their Host). Tests 17 green 3x (33/33 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
