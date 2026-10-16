# EV-P06-008: Tables with no tenant column are registered with a reason, so 'deliberately global' and 'forgot the column' cannot look the same

| Field | Value |
|---|---|
| Evidence ID | EV-P06-008 |
| Item | P06.02.05 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | repository |
| Command / procedure | docs/architecture/global-tables.md; check-rls-catalog rule unregistered-global-table |
| Result | one registered table today; a row without a reason does not count as registered |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan cancelled https://github.com/AyhamJo7/moin/actions/runs/36613380358; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36613380002; security-scan failure https://github.com/AyhamJo7/moin/actions/runs/36613380318; verify success https://github.com/AyhamJo7/moin/actions/runs/36613380290 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
