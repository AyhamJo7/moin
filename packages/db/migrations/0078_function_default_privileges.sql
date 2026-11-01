-- 0078 — a new function is not callable by PUBLIC (P06.01.02, INV-01; security acceptance F4).
--
-- 0003 revoked EXECUTE from PUBLIC with `ALTER DEFAULT PRIVILEGES … IN SCHEMA public` and `… IN
-- SCHEMA app`. PostgreSQL treats a per-schema default as an addition to the global one, not a
-- replacement: the built-in default grants EXECUTE on every new function to PUBLIC, and a revoke
-- scoped to a schema cannot remove a grant that is not scoped to it. A function the migrator
-- created in either schema was therefore callable by the application role before any GRANT.
--
-- This migration removes the global default for functions the migration role creates, so every new
-- function is granted by name, in the migration that adds it. It then removes PUBLIC's EXECUTE from
-- the functions that already exist in the two application schemas.
--
-- Only `app.current_org()` still held it. Every role that evaluates a tenant policy has its own
-- EXECUTE grant on it (0004), so nothing loses access it had; PUBLIC is simply no longer one of the
-- ways to get it. `moin_identity` is deliberately not granted: it reads no tenant table, and the
-- catalog check asserts that its only executable functions are the session functions.
--
-- A privilege change only: no table, column or data changes (expand/contract, INV-17).

ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app')
      AND pg_get_userbyid(p.proowner) = current_user
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
      AND EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
  END LOOP;
END
$$;

-- Restated so that this migration, not only 0004, is what the role set depends on.
GRANT EXECUTE ON FUNCTION app.current_org() TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
