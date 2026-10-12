# EV-P09-011: Approved-only retrieval: versioned view, closed-set catalogue, trigram candidates, exclusion suite (harness verdict)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-011 |
| Item | P09.09.05 |
| Date (UTC) | 2026-10-12 02:25 UTC (ROUND-1: P1 location fix + re-cite; initial 01:30 UTC) |
| Commit | `3549780` (ROUND-1 fix incl. EV + ledger; implementation `15d234e`, mutation measured at `b52c073`, gates at `b52c073` — same tree plus ledger pin) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261012T002209Z-full.json`): control-plane (30.6 s), control-plane-lint, conventions, docs-consistency, format (7.2 s), lint (15.9 s), boundaries, typecheck, unit (8.0 s), integration (26.6 s), migrations, build, licences, secret-scan. TEST_* vars exported from `.env.example` values (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #104 (draft): CI pending at push time |
| Reviewer | pending (re-review requested on PR #104 after ROUND-1 fix) |
| Mutation | Harness `KILLED_ASSERTION` 3/3 at HEAD `b52c073` — report on disk: `docs/verification/retrieval-mutation-report.md` (+ manifest `docs/verification/retrieval-mutation-manifest.json`): variant M1 (view conflict leg `AND i.conflict_state = 'clear'` neutralised to `OR true`) killed by `retrieval-exclusion > expired, suspended and conflicted never retrievable`; variant M2 (catalogue `active = true` leg removed) killed by `retrieval-exclusion > deactivated cards leave catalogue, candidates and answers`; variant M3 (candidates location leg loosened to `$3 null OR location null OR location = $3` — the always-true shapeshift of P1) killed by `retrieval-exclusion > candidates respect the fail-closed location rule`. M3 needed one iteration: dropping the leg entirely left an unbound `$3` (pg `could not determine data type`, reporter ERROR not ASSERTION), so the mutant keeps the binding and loosens the logic instead. Pre-ROUND-1 history: first sweep caught M1 SURVIVED (overdue peer also suspended/overdue); suite strengthened to pin the conflict-only peer (`760ca6b`), re-swept 2/2. |
| Design notes | ROUND-1 (codex BLOCK on 9b7871f, P1 location gap): `findCandidates` takes a validated `locationId` and applies the SAME fail-closed predicate as `matchCards`/`listCardCatalogue` (omitted → `location_id IS NULL` only; provided → global or matching). New test pins omitted/matching/different locations. P09.09.01–.03/.05 PILOT otherwise unchanged: migration 0060 `knowledge_approved_current` v1 (approved + valid + not suspended + not conflicted + overdue-restricted suppressed, `security_invoker` over FORCE RLS base tables); `listCardCatalogue` closed-set (ids + canonical + variants per channel, id order); `findCandidates` trigram ranking above `CANDIDATE_SIMILARITY_FLOOR = 0.3`; `readApprovedVersions` tenant-scoped view read. Seven exclusion tests green 3x (23/23 with knowledge + faq). pgvector HNSW passages stay SELL-deferred (P09.09.04). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
