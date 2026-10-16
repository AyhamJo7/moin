# EV-P06-002: PUBLIC is revoked from schemas and functions; default privileges grant the application role DML and nothing else

| Field | Value |
|---|---|
| Evidence ID | EV-P06-002 |
| Item | P06.01.02 |
| Date (UTC) | 2026-09-29 18:38 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, local stack |
| Command / procedure | psql: \dp and pg_default_acl after migration 0003 |
| Result | no TRUNCATE, no REFERENCES, no TRIGGER, no EXECUTE by default; every table migration also grants explicitly |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan cancelled https://github.com/AyhamJo7/moin/actions/runs/36613380358; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36613380002; security-scan failure https://github.com/AyhamJo7/moin/actions/runs/36613380318; verify success https://github.com/AyhamJo7/moin/actions/runs/36613380290 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
