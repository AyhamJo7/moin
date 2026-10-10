-- 0034 — close the 0003/0012 assertion gap for moin_identity (P06.01.06).
-- migration-check: allow truncate because the match is prose in this comment ("no TRUNCATE" as a
-- privilege name), not a statement: the file contains only DO-block assertions, no DDL.
--
-- 0003's expected-roles array predates moin_identity (ADR-0003 amendment 2026-10-02): it names the
-- seven P06.01.01 roles and passes without moin_identity even when the role is missing, so a dropped
-- role would silently leave every grant below it a no-op. 0012 asserts the role's attributes but is
-- not the place a reader looks for the role split, and nothing re-asserts the privilege boundary
-- after the fact: moin_identity executes exactly the seven session names, owns nothing, creates
-- nothing, and moin_app executes none of them. This migration re-asserts all of that in one place,
-- against the live catalog, on every apply — including upgrades from a database migrated before this
-- file existed. Pure assertions (DO blocks): no GRANT, no REVOKE, nothing for expand/contract to
-- carry, safe beside any release.

-- ---------------------------------------------------------------------------------------------
-- 1. moin_identity is one of the expected roles, with the api-only attributes.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    INTO r FROM pg_roles WHERE rolname = 'moin_identity';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'missing database role moin_identity. It is provisioned by the cluster owner (docker/postgres/init/00-roles.sql locally, the CI role step, Terraform in P05), not by migrations: moin_migrator has no CREATEROLE on purpose.';
  END IF;
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN
    RAISE EXCEPTION
      'moin_identity must be NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION.';
  END IF;
  -- TEMPORARY on the current database is CREATE TEMP TABLE; CREATE is CREATE SCHEMA, after which
  -- the role owns what it makes. Both are moved off moin_identity at provisioning — but a database
  -- created bare (CREATE DATABASE without the provisioning revokes, e.g. the audit-backfill tests)
  -- still carries PostgreSQL's PUBLIC defaults, so here they are a warning, not an error: the
  -- catalog check (section 8) and the identity-store tests pin the provisioned state on databases
  -- that have it.
  IF has_database_privilege('moin_identity', current_database(), 'TEMPORARY, CREATE') THEN
    RAISE WARNING 'moin_identity holds TEMPORARY or CREATE on database %: provision the ACLs (REVOKE from PUBLIC, GRANT CONNECT only to moin_identity).', current_database();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Usable membership: none, except the tolerated creator ADMIN-only grant.
-- ---------------------------------------------------------------------------------------------
--
-- Same shape as the 0012 assertion: moin_identity itself holds NO membership at all (a member
-- of a role inherits what that role may do, and the tolerated creator pattern below runs in the
-- other direction — who may use moin_identity, not what it may reach). The one membership
-- tolerated is the one PostgreSQL 16+ records by itself when a CREATEROLE non-superuser — the RDS
-- master user — creates a role: ADMIN only, with neither INHERIT nor SET, held by that kind of
-- role and nothing else (not one of ours, not reachable from any runtime role: ADMIN still lets
-- its holder grant the role onward, itself included).
DO $$
BEGIN
  -- moin_identity is a member of nothing.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'moin_identity')
  ) THEN
    RAISE EXCEPTION
      'moin_identity must be a member of no role: membership would extend what it may do.';
  END IF;
  -- No role may use it, except the tolerated creator ADMIN-only grant.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles h ON h.oid = m.member
    WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'moin_identity')
      AND NOT (
        m.admin_option AND NOT m.inherit_option AND NOT m.set_option
        AND h.rolcreaterole AND h.rolname NOT LIKE 'moin\_%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_roles rr
          WHERE rr.rolname IN ('moin_app', 'moin_provisioner', 'moin_dispatcher', 'moin_support_ro',
                               'moin_reporting', 'moin_readonly', 'moin_identity')
            AND pg_has_role(rr.oid, h.oid, 'MEMBER')
        )
      )
  ) THEN
    RAISE EXCEPTION
      'moin_identity must have no members, except an ADMIN-only grant (no INHERIT, no SET) to the CREATEROLE role that created it, which no moin runtime role can reach.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Owns nothing, and holds no table/column/sequence privilege anywhere.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  owned int;
  privs text;
BEGIN
  SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'moin_identity'::regrole)
       + (SELECT count(*) FROM pg_proc WHERE proowner = 'moin_identity'::regrole)
       + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'moin_identity'::regrole)
       + (SELECT count(*) FROM pg_type WHERE typowner = 'moin_identity'::regrole)
       + (SELECT count(*) FROM pg_database WHERE datdba = 'moin_identity'::regrole)
       + (SELECT count(*) FROM pg_largeobject_metadata WHERE lomowner = 'moin_identity'::regrole)
    INTO owned;
  IF owned > 0 THEN
    RAISE EXCEPTION 'moin_identity owns % object(s) and must own nothing.', owned;
  END IF;
  SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY n.nspname || '.' || c.relname)
    INTO privs
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')
      AND (has_table_privilege('moin_identity', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
        OR (c.relkind <> 'S' AND has_any_column_privilege('moin_identity', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
        OR (c.relkind = 'S' AND has_sequence_privilege('moin_identity', c.oid, 'USAGE, SELECT, UPDATE')));
  IF privs IS NOT NULL THEN
    RAISE EXCEPTION 'moin_identity holds a table/column/sequence privilege on: %.', privs;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Executes exactly the seven session names; moin_app executes none of them.
-- ---------------------------------------------------------------------------------------------
--
-- Name-level, so a future overload is caught by the catalog check's per-signature rules and by the
-- identity-store matrix test, not silently absorbed here. reject_session_rewrite is the trigger
-- that fixes a session's lifetime and is not executable by either role.
--
-- The second pair of checks is deliberately NOT filtered to SECURITY DEFINER: an explicit EXECUTE
-- grant on a non-definer function would pass a definer-only assertion but fail the catalog check's
-- direct-grant comparison. moin_identity may execute nothing outside the seven names, whatever the
-- function's security attribute; moin_app may execute nothing with those names at all.
-- The extra-name pair below mirrors the catalog check's two-list verdict (section 8): the
-- definer-executable set and the explicit-grant set (aclexplode on proacl, PUBLIC built-ins
-- excluded — those execute with the caller's own privileges and give the role nothing) must each
-- collapse to exactly the seven session names. An explicit EXECUTE on a non-definer function would
-- pass a definer-only assertion but fail the catalog's grant comparison.
DO $$
DECLARE
  got text[];
  want text[] := ARRAY[
    'app.begin_session', 'app.begin_sign_in', 'app.consume_sign_in',
    'app.resolve_request_context', 'app.resolve_session', 'app.revoke_session', 'app.rotate_session'
  ];
  granted text[];
  leak text[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT n.nspname || '.' || p.proname ORDER BY n.nspname || '.' || p.proname), '{}')
    INTO got
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND has_function_privilege('moin_identity', p.oid, 'EXECUTE');
  IF got <> want THEN
    RAISE EXCEPTION 'moin_identity executes %, want exactly %.', got, want;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT n.nspname || '.' || p.proname ORDER BY n.nspname || '.' || p.proname), '{}')
    INTO granted
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 'moin_identity'::regrole
      AND n.nspname NOT IN ('pg_catalog', 'information_schema');
  IF granted <> want THEN
    RAISE EXCEPTION 'functions granted to moin_identity: %; want exactly %.', granted, want;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT n.nspname || '.' || p.proname ORDER BY n.nspname || '.' || p.proname), '{}')
    INTO leak
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND (n.nspname || '.' || p.proname) = ANY (want)
      AND has_function_privilege('moin_app', p.oid, 'EXECUTE');
  IF leak <> '{}' THEN
    RAISE EXCEPTION 'moin_app must execute none of the session functions, executes: %.', leak;
  END IF;
END
$$;
