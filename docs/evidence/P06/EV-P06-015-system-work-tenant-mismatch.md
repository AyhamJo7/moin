# EV-P06-015: A job envelope naming the wrong organisation updates zero rows rather than the wrong tenant's row

| Field | Value |
|---|---|
| Evidence ID | EV-P06-015 |
| Item | P06.14.02 |
| Date (UTC) | 2026-09-29 19:56 UTC |
| Commit | `c2c25800e9bee4e2d2aba2d5acc6bd1cb6499949` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — 'a job whose envelope names the wrong organisation has no effect' |
| Result | rowCount 0 and the target row unchanged; the mismatch is an empty path, not an error path |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
