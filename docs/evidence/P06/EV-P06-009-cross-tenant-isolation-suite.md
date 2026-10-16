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
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan cancelled https://github.com/AyhamJo7/moin/actions/runs/36613380358; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36613380002; security-scan failure https://github.com/AyhamJo7/moin/actions/runs/36613380318; verify success https://github.com/AyhamJo7/moin/actions/runs/36613380290 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
