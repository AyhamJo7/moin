# EV-P09-011: Approved-only retrieval: versioned view, closed-set catalogue, trigram candidates, exclusion suite (harness verdict)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-011 |
| Item | P09.09.05 |
| Date (UTC) | 2026-10-12 03:00 UTC (ROUND-2: evidence-only re-cite; ROUND-1 P1 fix 02:25 UTC; initial 01:30 UTC) |
| Commit | `ROUND2-SHA` (ROUND-2 evidence-only: EV + mutation records pin; code unchanged since `15d234e`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261012T004114Z-full.json`): control-plane (31.6 s), control-plane-lint, conventions, docs-consistency, format (7.2 s), lint, boundaries, typecheck, unit (7.8 s), integration (29.6 s), migrations, build, licences, secret-scan. TEST_* vars exported from `.env.example` values (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #104 (draft): CI pending at push time |
| Reviewer | pending (re-review requested on PR #104 after ROUND-1 fix) |
| Mutation | ROUND-2 (evidence-only, HEAD `227906a`, no code changes): (a) sweep harness `KILLED_ASSERTION` 3/3 — re-run at this HEAD, report on disk `docs/verification/retrieval-mutation-report.md` (+ results JSON `docs/verification/retrieval-mutation-results.json`, both record HEAD `227906a`): M1 (view conflict leg) / M2 (catalogue active leg) / M3 (candidates location leg, assertion-safe shapeshift) each killed by its named exclusion test; (b) `mutation_check.py` KILLED at HEAD `227906a` for the P1 fix (`--fix-ref 15d234e --fix-paths packages/db/src/retrieval.ts`, location test FAILS without / PASSES with, byte-identical restore) — record on disk `.git/claude-evidence/mutation/latest.json` (verdict KILLED, head `227906a`, no longer the stale base-`cc459c3` file-absence run). ROUND-1 history kept below. |
| Design notes | ROUND-1 (codex BLOCK on 9b7871f, P1 location gap): `findCandidates` takes a validated `locationId` and applies the SAME fail-closed predicate as `matchCards`/`listCardCatalogue` (omitted → `location_id IS NULL` only; provided → global or matching). New test pins omitted/matching/different locations. P09.09.01–.03/.05 PILOT otherwise unchanged: migration 0060 `knowledge_approved_current` v1 (approved + valid + not suspended + not conflicted + overdue-restricted suppressed, `security_invoker` over FORCE RLS base tables); `listCardCatalogue` closed-set (ids + canonical + variants per channel, id order); `findCandidates` trigram ranking above `CANDIDATE_SIMILARITY_FLOOR = 0.3`; `readApprovedVersions` tenant-scoped view read. Seven exclusion tests green 3x (23/23 with knowledge + faq). pgvector HNSW passages stay SELL-deferred (P09.09.04). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
