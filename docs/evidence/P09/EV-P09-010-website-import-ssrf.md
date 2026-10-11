# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-1 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 21:30 UTC (ROUND-1 fix; initial 20:50 UTC) |
| Commit | `TBD (this push)` — prior pin `c2cfbd5` (superseded by ROUND-1) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T211923Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (30.3 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-1 fix) |
| Mutation | Semantic KILLED at this HEAD (private-address predicate disabled: the 3 private-address tests FAIL — rebinding + literal + robots-pinned — while the other 12 pass; restored byte-identical). Harness verdict is file-absence (fix files untracked pre-commit), so the semantic run above is the proof, recorded here. |
| Design notes | ROUND-1 (codex BLOCK on c2cfbd5, 6 findings): #1 streaming caps — body consumed via Reader with size enforced WHILE reading + deadline held across the whole read (slow-drip + chunked-overrun fixtures); #2 TLS — hostname URL preserved end to end, pinned address out-of-band for the connector (test pins hostname intact); #3 ULA — fc00::/7 refused (+ test); #4 robots rebinding — robots.txt via resolvePinned (test pins zero dials on refusal); #5 URL privacy — redactUrlForStorage on ALL persisted run rows (scheme + host + path; test pins no credentials/query); #6 provenance — import_flagged + import_source_url on version rows via KnowledgeMetadata (migration 0059 UNMERGED extended; review UI reads without lookup; test pins flag + url). Inventory rows for provenance columns. Tests 15 green 3x (31/31 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
