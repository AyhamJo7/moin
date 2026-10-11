# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 20:50 UTC |
| Commit | `d94e4da` (impl `567f499` + ledger; branch `feat/p09-08-import`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T204528Z-full.json`): control-plane 30.8 s, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration 28.4 s, migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft): CI pending at push time |
| Reviewer | pending (review requested on PR #103) |
| Mutation | Semantic KILLED (private-address check disabled: the 2 private-address tests FAIL — rebinding + literal — while the other 8 pass; restored byte-identical). Harness verdict KILLED is file-absence (fix files untracked pre-commit), so the semantic run above is the proof, recorded here. |
| Design notes | 0059 additive only (business_domains registry + import runs trail + RLS/FORCE + allowlist rows). Domain gate: registrable domain must match a verified tenant row (fetch never attempted otherwise — pinned by test). Fetch guard: DNS pinned up front with every address classified (rebinding-proof), private ranges refused (v4/metadata/loopback/ipv6/mapped), redirects re-verified per hop (max 3), robots honoured, 1 MiB + 10 s caps. HTML→text deterministic; injection markers flagged (never executed). Drafts source=import via createKnowledgeItem, invisible to serving until P09.05 approval. Manual entry rides existing create/edit APIs (P09.08.01, no new surface). PDF/menu LAUNCH deferred (P09.08.03, no columns). Inventory rows added. Tests 10 green 3x (26/26 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
