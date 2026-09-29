# EV-P02-025: dev:up, dev:down, dev:reset, db:migrate and db:seed work end to end

| Field | Value |
|---|---|
| Evidence ID | EV-P02-025 |
| Item | P02.04.02 |
| Date (UTC) | 2026-09-28 13:10 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | pnpm dev:up / dev:down / dev:reset wrap docker compose with --wait, so the command returns when the stack is usable rather than when it has been asked to start. pnpm db:migrate applied 0001_schema_migrations against a freshly initialised database and reported "applied 1"; a second run reported "nothing to apply (1 migration(s) already applied)", so it is idempotent. The runner takes a Postgres advisory lock (concurrent runners during a rolling deploy cannot half-apply a schema), runs each migration in its own transaction with the bookkeeping row written inside it, and compares checksums so an edited applied migration fails loudly. 13 unit tests cover ordering by numeric prefix, rejection of unordered filenames, rejection of duplicate versions, non-SQL files, and checksum derivation. pnpm db:seed ran and reported "seeded 0 row(s)" with the reason. |
| Result | PASS for the commands. EXPLICIT PARTIAL SCOPE: the two demo tenants (Musterrestaurant, Musterbetrieb SHK) are DEFINED in packages/db/src/seed.ts but no rows are applied, because the tenancy schema is P06.04. Creating organisations here would either leave P06 reconciling two designs or create a tenant table without FORCE ROW LEVEL SECURITY, which INV-01 forbids. db:seed says exactly this when it runs rather than reporting success. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
