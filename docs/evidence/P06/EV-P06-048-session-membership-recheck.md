# EV-P06-048: per-request session validity and membership re-check; single DEFINER lookup; GET-only 30s cache

| Field | Value |
|---|---|
| Evidence ID | EV-P06-048 |
| Item | P06.06.03 |
| Date (UTC) | 2026-10-05 |
| Commit | `ea42c82` (implementation HEAD; governance record follows separately) |
| Environment | local |
| Command / procedure | Migration `0013` (`memberships` tenant table, FORCE RLS, scoped lookup policy) + `0014` (`app.resolve_request_context` DEFINER, canonical lock order, DB clock, marker GUC set/reset); guard + interceptor + tenant pool (api-only); suites: session-membership 9/9, tenant-isolation, rls-catalog 43/43, identity-store, readiness-identity; `gates.py fast` 7/7 |
| Result | READY_FOR_REVIEW — every request re-checks session + active membership in one DEFINER call (zero rows → 401; several → 401 ambiguous); GET-only ≤30 s cache (injected clock, lookup-count proven), mutations always fresh; FS-16 disable/remove fails next request; no org id from caller (INV-02); `moin_identity` gains no table grant; voice/worker/migrate graphs untouched |
| QG-09 | Required (DEFINER + RLS touch): security + architecture + invariant reviewers on the final implementation SHA before founder review |
| Reviewer | pending (founder review) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
