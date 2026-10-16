# EV-P06-011: withTenant opens a transaction, sets the tenant transaction-locally, and carries an ambient context

| Field | Value |
|---|---|
| Evidence ID | EV-P06-011 |
| Item | P06.03.01 |
| Date (UTC) | 2026-09-29 19:56 UTC |
| Commit | `c2c25800e9bee4e2d2aba2d5acc6bd1cb6499949` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | pnpm test:integration — packages/db/src/tenant.integration.test.ts |
| Result | 22 assertions: commits, rolls back, releases the client either way, and leaves nothing on the pooled connection |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan success https://github.com/AyhamJo7/moin/actions/runs/36621792019; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36621791979; security-scan success https://github.com/AyhamJo7/moin/actions/runs/36621792166; verify success https://github.com/AyhamJo7/moin/actions/runs/36621792242 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
