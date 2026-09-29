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
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
