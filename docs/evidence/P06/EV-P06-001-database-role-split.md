# EV-P06-001: The seven-role split exists and the migration asserts it, failing with the name of any missing role

| Field | Value |
|---|---|
| Evidence ID | EV-P06-001 |
| Item | P06.01.01 |
| Date (UTC) | 2026-09-29 18:38 UTC |
| Commit | `21b5ad23486a350032baf4f06f0644870c8d7eed` (working tree had uncommitted changes) |
| Environment | PostgreSQL 17, local stack |
| Command / procedure | packages/db/migrations/0003_roles_and_privileges.sql applied; docker/postgres/init/00-roles.sql provisions the roles |
| Result | applied; PLAN says 'migration creating' — a migration cannot create roles because moin_migrator has no CREATEROLE, which is the point of the split. It asserts instead, and the deviation is stated in the migration header |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
