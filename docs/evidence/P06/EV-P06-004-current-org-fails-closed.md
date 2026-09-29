# EV-P06-004: app.current_org() returns NULL when unset or empty, so every policy matches no rows rather than all rows

| Field | Value |
|---|---|
| Evidence ID | EV-P06-004 |
| Item | P06.02.01 |
| Date (UTC) | 2026-09-29 18:38 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — 'with no tenant set' cases |
| Result | no tenant and empty tenant both yield zero rows; an insert is rejected rather than landing in no tenant |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
