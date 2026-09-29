# EV-P06-010: The catalog check fails on a fixture table with row-level security enabled but not forced, and on six other mistakes

| Field | Value |
|---|---|
| Evidence ID | EV-P06-010 |
| Item | P06.02.07 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — scripts/check-rls-catalog.integration.test.ts |
| Result | 9 cases pass, each building the mistake in a private database; wired into the rls-catalog CI job |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
