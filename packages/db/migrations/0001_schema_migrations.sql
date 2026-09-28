-- 0001 — migration bookkeeping.
--
-- Owned by the migrator role, which is the only role permitted to run DDL. The application role
-- can read it (so a deployed service can report which schema version it is running against) and
-- cannot write it.
--
-- `checksum` exists so an already-applied migration that is later edited is detected. A migration
-- file is immutable once applied: editing one means production and a fresh database diverge
-- silently, which is the failure this column turns into a loud one.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version      text        NOT NULL PRIMARY KEY,
  name         text        NOT NULL,
  checksum     text        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  duration_ms  integer     NOT NULL
);

COMMENT ON TABLE schema_migrations IS
  'Applied migrations. Rows are never updated or deleted; a mistake becomes a new migration.';
