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
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
