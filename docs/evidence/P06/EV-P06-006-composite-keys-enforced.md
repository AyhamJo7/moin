# EV-P06-006: Composite unique keys and composite foreign keys are enforced against the live catalog, not by review

| Field | Value |
|---|---|
| Evidence ID | EV-P06-006 |
| Item | P06.02.03 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, per-file test database |
| Command / procedure | scripts/check-rls-catalog.ts rules no-composite-unique and foreign-key-not-composite |
| Result | both proven by fixtures; a foreign key whose target is organisations is exempt because the parent is the tenant |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan cancelled https://github.com/AyhamJo7/moin/actions/runs/36613380358; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36613380002; security-scan failure https://github.com/AyhamJo7/moin/actions/runs/36613380318; verify success https://github.com/AyhamJo7/moin/actions/runs/36613380290 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
