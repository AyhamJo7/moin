# EV-P09-009: Conflict detection: deterministic hours overlap, faq duplicate candidates, suspension and resolution

| Field | Value |
|---|---|
| Evidence ID | EV-P09-009 |
| Item | P09.07.04 |
| Date (UTC) | 2026-10-11 20:00 UTC |
| Commit | `f8c39b2` (impl `c1ef48d` + ledger; branch `feat/p09-07-conflicts`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T195550Z-full.json`): control-plane 31.0 s, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration 28.7 s, migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #102 (draft): CI pending at push time |
| Reviewer | pending (review requested on PR #102) |
| Mutation | `mutation_check.py` KILLED (conflicts suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | 0058 additive only (conflict_state default clear, conflicts table + RLS/FORCE + leg-ordering note, task FK per 0057 pattern, allowlist rows). Hours-overlap: same location + weekday, segment-normalized incl. midnight-spanning; faq-duplicate: trigram >= 0.6, flag-only. Serving: conflict_state = clear in getLiveVersion + servedState; faq suspend = active=false. Legs ordered service-side (no trigger — no catalog review surface; UNIQUE refuses mirrors). Per-pair idempotency: conflict UNIQUE + task keys; repeat detection reports opened=false. Resolution clears only subjects with no other open conflict. Audit markers only (detector markers). Inventory rows added. Tests 6 green 3x (22/22 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
