# EV-P06-048: per-request session validity and membership re-check; single DEFINER lookup; GET-only 30s cache

| Field | Value |
|---|---|
| Evidence ID | EV-P06-048 |
| Item | P06.06.03 |
| Date (UTC) | 2026-10-05 |
| Commit | `1169972` (implementation HEAD; governance record follows separately) |
| Environment | local |
| Command / procedure | Migration `0013` (`memberships` tenant table, FORCE RLS, scoped lookup policy) + `0014` (`app.resolve_request_context` DEFINER, canonical lock order, DB clock, marker GUC set/reset); guard + interceptor + tenant pool (api-only); suites: session-membership 9/9, tenant-isolation, rls-catalog 43/43, identity-store, readiness-identity; `gates.py fast` 7/7 |
| Result | READY_FOR_REVIEW — every request re-checks session + active membership in one DEFINER call (zero rows → 401; several → 401 ambiguous); GET-only ≤30 s cache (injected clock, lookup-count proven), mutations always fresh; FS-16 disable/remove fails next request; no org id from caller (INV-02); `moin_identity` gains no table grant; voice/worker/migrate graphs untouched |
| QG-09 | Three-green set at exact `1169972`: security OK TO MERGE (1 carried LOW: guarded-200 Cache-Control), architecture OK TO MERGE (H2 accepted per PLAN 30 s ceiling, M1 P06.07 follow-up), invariant OK TO MERGE (I2 atomic-slide follow-up P06.07+) |
| Security-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/security-reviewer-1169972.md` |
| Architecture-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-1169972.md` |
| Invariant-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-1169972.md` |
| Residuals (P06.07+ backlog, non-blocking) | Guarded-200 Cache-Control header; global guard / route-inventory test; atomic slide+membership DEFINER call |
| Reviewer | pending (founder review) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
