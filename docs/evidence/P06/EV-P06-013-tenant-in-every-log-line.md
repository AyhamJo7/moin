# EV-P06-013: Every log line inside a tenant transaction carries its organisation, and the allowlist still applies to it

| Field | Value |
|---|---|
| Evidence ID | EV-P06-013 |
| Item | P06.03.06 |
| Date (UTC) | 2026-09-29 19:56 UTC |
| Commit | `c2c25800e9bee4e2d2aba2d5acc6bd1cb6499949` (working tree had uncommitted changes) |
| Environment | local, Node 24.21.0 |
| Command / procedure | pnpm vitest run --project unit packages/observability |
| Result | 3 assertions including one that returns a phone number from the context function and finds it redacted |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
