# EV-P06-007: The catalog check reads pg_catalog: RLS forced, policies complete, no runtime role can bypass, every SECURITY DEFINER allowlisted and pinned

| Field | Value |
|---|---|
| Evidence ID | EV-P06-007 |
| Item | P06.02.04 |
| Date (UTC) | 2026-09-29 18:39 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, local stack and CI |
| Command / procedure | node scripts/check-rls-catalog.ts |
| Result | clean on the migrated schema; 7 rules, each with a fixture that makes it fire |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan cancelled https://github.com/AyhamJo7/moin/actions/runs/36613380358; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36613380002; security-scan failure https://github.com/AyhamJo7/moin/actions/runs/36613380318; verify success https://github.com/AyhamJo7/moin/actions/runs/36613380290 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
