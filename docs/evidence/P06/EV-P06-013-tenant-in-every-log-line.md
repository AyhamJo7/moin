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
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan success https://github.com/AyhamJo7/moin/actions/runs/36621792019; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36621791979; security-scan success https://github.com/AyhamJo7/moin/actions/runs/36621792166; verify success https://github.com/AyhamJo7/moin/actions/runs/36621792242 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
