# EV-P06-005: One function applies ENABLE + FORCE and a USING/WITH CHECK policy, so no table gets its own copy to diverge

| Field | Value |
|---|---|
| Evidence ID | EV-P06-005 |
| Item | P06.02.02 |
| Date (UTC) | 2026-09-29 18:38 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, local stack |
| Command / procedure | app.apply_tenant_rls(regclass); scripts/check-rls-catalog.ts |
| Result | both tenant tables forced and policed; the function refuses a table with no organisation_id column |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
