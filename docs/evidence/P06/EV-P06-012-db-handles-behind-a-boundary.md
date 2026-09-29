# EV-P06-012: Raw pool handles are importable only through @moin/db/pool, and the boundary rule forbids that import outside platform and health

| Field | Value |
|---|---|
| Evidence ID | EV-P06-012 |
| Item | P06.03.05 |
| Date (UTC) | 2026-09-29 19:56 UTC |
| Commit | `c2c25800e9bee4e2d2aba2d5acc6bd1cb6499949` (working tree had uncommitted changes) |
| Environment | dependency-cruiser 18.4.0 |
| Command / procedure | pnpm vitest run --project unit packages/config/src/boundaries; pnpm depcruise |
| Result | the rule fires on a fixture and is clean on the tree; withTenant is now the sanctioned alternative it points callers to |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
