# EV-P06-007: The catalog check reads pg_catalog: RLS forced, policies complete, no runtime role can bypass, every SECURITY DEFINER allowlisted and pinned

| Field | Value |
|---|---|
| Evidence ID | EV-P06-007 |
| Item | P06.02.04 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, local stack and CI |
| Command / procedure | node scripts/check-rls-catalog.ts |
| Result | clean on the migrated schema; 7 rules, each with a fixture that makes it fire |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
