# EV-P06-003: The application role cannot run DDL, TRUNCATE, disable a policy, become a privileged role, or own a table

| Field | Value |
|---|---|
| Evidence ID | EV-P06-003 |
| Item | P06.01.05 |
| Date (UTC) | 2026-09-29 18:38 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — packages/db/src/tenant-isolation.integration.test.ts |
| Result | 8 assertions, all as the NOBYPASSRLS application role against a real database |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
