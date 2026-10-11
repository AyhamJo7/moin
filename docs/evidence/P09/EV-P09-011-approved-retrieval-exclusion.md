# EV-P09-011: Approved-only retrieval: versioned view, closed-set catalogue, trigram candidates, exclusion suite (harness verdict)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-011 |
| Item | P09.09.05 |
| Date (UTC) | 2026-10-12 01:30 UTC |
| Commit | `05fd6cf` (ledger pin incl. EV + implementation; code HEAD `7ab1ab3`, mutation measured at `49e15a5`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T233333Z-full.json`): control-plane (22.5 s), control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit (5.7 s), integration (23.9 s), migrations, build, licences, secret-scan. TEST_* vars exported from `.env.example` values (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. Earlier full runs on this tree failed only on Keycloak-dependent suites missing `TEST_OIDC_ISSUER_URL` in the gate-inherited env; the suites pass standalone and the cited run has all vars present. |
| Result | PASS |
| CI run / artifact | PR #104 (draft, this push): CI pending at push time |
| Reviewer | pending |
| Mutation | Harness `KILLED_ASSERTION` 2/2 at HEAD `49e15a5` — report on disk: `docs/verification/retrieval-mutation-report.md` (+ manifest `docs/verification/retrieval-mutation-manifest.json`): variant M1 (view conflict leg `AND i.conflict_state = 'clear'` neutralised to `OR true`) killed by `retrieval-exclusion > expired, suspended and conflicted never retrievable`; variant M2 (catalogue `active = true` leg removed) killed by `retrieval-exclusion > deactivated cards leave catalogue, candidates and answers`. First sweep caught M1 SURVIVED (overdue peer also suspended/overdue — exclusion held via parallel legs); the suite was strengthened to pin the conflict-only peer via view + service (`760ca6b`), then re-swept 2/2. |
| Design notes | P09.09.01–.03/.05 PILOT: migration 0060 defines `knowledge_approved_current` v1 (approved + valid + not suspended + not conflicted + overdue-restricted suppressed, `security_invoker` over FORCE RLS base tables — the ONLY assistant retrieval source in SQL, mirroring the `getLiveVersion`/`servedState` service predicate); `listCardCatalogue` is the NLU closed-set catalogue (ids + canonical + variants per channel, deterministic id order, no scores); `findCandidates` is trigram ranking above `CANDIDATE_SIMILARITY_FLOOR = 0.3` for large catalogues; `readApprovedVersions` reads the view through the tenant txn. Six exclusion tests (drafts/retired/expired/suspended/conflicted/disallowed-channel/tenant never retrievable). pgvector HNSW passages stay SELL-deferred (P09.09.04). Tests 6 green 3x (22/22 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
