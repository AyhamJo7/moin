# EV-P02-029: Real-Postgres harness: a database cloned from a migrated template per test file

| Field | Value |
|---|---|
| Evidence ID | EV-P02-029 |
| Item | P02.05.02 |
| Date (UTC) | 2026-09-28 16:33 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local (PostgreSQL 17 + pgvector in the compose stack) |
| Command / procedure | global-setup.ts rebuilds moin_test_template once per run (drop, create, create the four extensions as the admin role because CREATE EXTENSION needs privileges the migration role deliberately lacks, then apply migrations) and marks it datistemplate. createTestDatabase() clones it with CREATE DATABASE ... TEMPLATE, naming it from the worker id plus random hex so parallel workers cannot collide, and drop() terminates stragglers before DROP DATABASE ... WITH (FORCE). Tests connect as moin_app. Five tests assert the harness itself: the clone already has migrations applied; the connecting role is neither superuser nor BYPASSRLS; two callers get separate databases (a table in one is invisible in the other); drop() actually removes the database; and the extensions are present. |
| Result | PASS — 5/5. The role assertion is the load-bearing one: an embedded or in-memory Postgres runs as superuser and silently bypasses RLS, so a cross-tenant test would pass against it while the policy it claims to verify does not exist. Two real defects were found by these tests: the template was created bare, so it had no pgvector; and migration 0001 described a SELECT grant for the application role in a comment but never issued it, so the app role could not read schema_migrations. The second was fixed as migration 0002 rather than by editing 0001 — the runner compares checksums precisely so an applied migration cannot change underneath an existing database. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
