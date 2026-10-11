# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-4 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 22:45 UTC (ROUND-4 fix; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `TBD (this push)` — prior pin `136a8c8` (superseded by ROUND-4) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T220919Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (24.8 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-4 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate in resolvePinned disabled: exactly the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 14 pass; restored byte-identical). |
| Design notes | ROUND-4 (codex BLOCK on 136a8c8, truncation P1 + evidence): finish() on success preserves queued chunks (clears ONLY on failure) — a body fully flushed before the first read drains intact instead of truncating to empty. Connector proof now single-flush full-body + immediate end with post-end drain (the exact truncation shape). Tests 17 green 3x (33/33 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
