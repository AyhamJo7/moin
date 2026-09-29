# EV-P06-014: Cross-tenant work claims identifiers only, then processes each item in its own tenant transaction

| Field | Value |
|---|---|
| Evidence ID | EV-P06-014 |
| Item | P06.14.01 |
| Date (UTC) | 2026-09-29 19:56 UTC |
| Commit | `c2c25800e9bee4e2d2aba2d5acc6bd1cb6499949` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — the withSystemWork cases |
| Result | no role sees two tenants at once; one failing item does not abandon the rest; a malformed claim is rejected before any work runs |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
