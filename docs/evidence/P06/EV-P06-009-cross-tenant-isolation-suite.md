# EV-P06-009: Cross-tenant SELECT, INSERT, UPDATE and DELETE are all blocked, as the application role against real policies

| Field | Value |
|---|---|
| Evidence ID | EV-P06-009 |
| Item | P06.02.06 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — packages/db/src/tenant-isolation.integration.test.ts |
| Result | 20 assertions: reads return nothing, writes are rejected by WITH CHECK, updates and deletes affect zero rows without erroring |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
