-- 0002 — let the application role read the migration bookkeeping.
--
-- 0001 described this in a comment and never granted it, so a deployed service could not report
-- which schema version it was running against, and the test harness could not assert that a
-- cloned database had its migrations applied.
--
-- This is a separate migration rather than an edit to 0001 on purpose: 0001 has already been
-- applied, and the runner compares checksums precisely so that an applied migration cannot be
-- changed underneath an existing database. A mistake becomes the next migration.
--
-- SELECT only. The application role must never write this table: if it could, a compromised
-- application could claim a migration had been applied that had not.

GRANT SELECT ON TABLE schema_migrations TO moin_app;
GRANT SELECT ON TABLE schema_migrations TO moin_readonly;
