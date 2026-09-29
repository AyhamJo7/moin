-- 0003 — the role split and its privileges (P06.01, ADR-0003, INV-01).
--
-- ## Why the roles are asserted here rather than created here
--
-- P06.01.01 asks for "a migration creating" the seven roles. It cannot literally do that, and the
-- reason is the point of the phase: roles are cluster-level objects and creating one needs
-- CREATEROLE, which `moin_migrator` deliberately does not have. A migration that could create
-- roles could create a superuser, and the separation between "may change the schema" and "may
-- change who may do anything" is exactly what this split buys.
--
-- So login roles are provisioned by whatever owns the cluster — `docker/postgres/init/00-roles.sql`
-- locally, Terraform in P05 — and this migration does two things the migrator legitimately can:
-- it **asserts** every expected role exists, failing loudly with the name of the missing one, and
-- it sets every privilege, revocation and default privilege.
--
-- Failing loudly matters more than it sounds. A missing role would otherwise make the GRANTs below
-- silently no-ops in a database where they are the only thing standing between two tenants.
--
-- ## What `moin_app` may do
--
-- Nothing by default. `PUBLIC` is revoked from the schema and from every function, so a new table
-- or function is inaccessible until something grants it — which is the safe direction for a
-- mistake to fail in. Table grants arrive with the migrations that create the tables.

-- ---------------------------------------------------------------------------------------------
-- 1. Every expected role exists.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  expected text[] := ARRAY[
    'moin_owner',        -- owns schema objects; never used by a running service
    'moin_migrator',     -- the only role that runs DDL
    'moin_app',          -- runtime tenant work; NOBYPASSRLS, owns nothing
    'moin_provisioner',  -- may execute provision_tenant() and nothing else
    'moin_dispatcher',   -- outbox, inbox, job history, timers; no tenant tables
    'moin_support_ro',   -- support diagnostics, through grant-gated views only
    'moin_reporting'     -- aggregate, PII-free views only
  ];
  missing text[];
  name text;
BEGIN
  FOREACH name IN ARRAY expected LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name) THEN
      missing := array_append(missing, name);
    END IF;
  END LOOP;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'missing database role(s): %. Roles are provisioned by the cluster owner (docker/postgres/init/00-roles.sql locally, Terraform in P05), not by migrations: moin_migrator has no CREATEROLE on purpose, because a role that can create roles can create a superuser.',
      array_to_string(missing, ', ');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. No *runtime* role has BYPASSRLS. INV-01 rests on this, and nothing else asserts it on apply.
-- ---------------------------------------------------------------------------------------------
--
-- `moin_owner` and `moin_migrator` are excluded deliberately, and the distinction is worth stating
-- because it looks like a loophole. Neither is ever used by a running service: the owner holds
-- objects and does not log in in production, and the migrator runs only in the `migrate` task.
-- Locally the owner *is* the cluster's bootstrap superuser, and a superuser bypasses row-level
-- security whatever its role attributes say — which is exactly why every tenant policy is created
-- with FORCE ROW LEVEL SECURITY, so that it applies to the table's owner as well.
--
-- What must never have BYPASSRLS is a role that serves traffic. For those, this fails the apply.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO offenders
  FROM pg_roles
  WHERE rolname IN ('moin_app', 'moin_provisioner', 'moin_dispatcher', 'moin_support_ro', 'moin_reporting')
    AND (rolbypassrls OR rolsuper);

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'runtime role(s) % can bypass row-level security. Tenant isolation would then hold everywhere except where it is needed (INV-01).',
      offenders;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Nothing is reachable by default.
-- ---------------------------------------------------------------------------------------------

-- A function is EXECUTE-able by PUBLIC unless revoked, which is the wrong default for a database
-- whose SECURITY DEFINER functions are the only way across a tenant boundary.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
  moin_app, moin_migrator, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT CREATE ON SCHEMA public TO moin_migrator, moin_owner;

-- `app` holds the helpers RLS policies call. Separate from `public` so that "what a policy may
-- call" is a schema rather than a naming convention.
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION moin_migrator;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- 4. Default privileges: what a table created by the migrator grants automatically.
-- ---------------------------------------------------------------------------------------------
--
-- Deliberately narrow. `moin_app` gets DML on future tables in `public` and nothing else: no
-- TRUNCATE (which bypasses row-level security entirely and is not recoverable), no REFERENCES,
-- no TRIGGER. Sequences are usage-only; the application generates UUIDv7 identifiers itself, and
-- the only sequences are per-tenant audit counters.
--
-- **These are a safety net, not the mechanism.** Default privileges are recorded per *grantor*,
-- so they apply only to objects created by the role that set them — and the integration template
-- builds its schema through the admin connection rather than the migration role. Relying on them
-- made every table in that template unreadable by the application role, which surfaced as
-- `permission denied` in eleven isolation tests, far from its cause.
--
-- So every migration that creates a table **grants explicitly**, and these exist only so that a
-- table created without a grant is unreachable rather than world-readable. Extending them to
-- `moin_owner` would require making the migrator a member of the owner role, which locally is the
-- bootstrap superuser: a larger change to the role graph than the problem warrants.
ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO moin_app;
ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO moin_app;


-- A new function is not callable until it is granted. SECURITY DEFINER functions are the one
-- path across a tenant boundary, so each one is granted by name, in the migration that adds it.
ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator IN SCHEMA app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- 5. Existing objects.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON TABLE schema_migrations FROM PUBLIC;
GRANT SELECT ON TABLE schema_migrations TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

COMMENT ON SCHEMA app IS
  'Helpers that row-level-security policies call. Nothing here may return another tenant''s rows.';
