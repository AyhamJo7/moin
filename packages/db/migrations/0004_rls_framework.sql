-- 0004 — the row-level-security framework (P06.02, ADR-0003, INV-01, INV-02).
--
-- ## The shape of the guarantee
--
-- Tenant isolation is enforced by the database, not by the application. The application is
-- expected to be wrong occasionally — a hand-written query, a new job handler, a webhook nobody
-- reviewed — and the property that matters is that being wrong is not sufficient to leak. So
-- every tenant table carries a policy, the policy is FORCEd so it applies to the table's owner
-- too, and the runtime role has no way around it.
--
-- ## Fail closed, deliberately
--
-- `app.current_org()` returns NULL when the setting is unset or empty. A NULL on either side of
-- `=` yields NULL, which is not TRUE, so a policy comparing against it matches **no rows**. Code
-- that forgets `withTenant` therefore sees an empty table rather than every tenant's rows.
--
-- That is the single most important line in this file, and it is easy to get wrong in the other
-- direction: `current_setting('app.organisation_id')` without the `true` argument *raises* when
-- unset, which sounds stricter and is worse — an exception is caught somewhere and turned into a
-- 500, while an empty result is a correct answer to a question asked without a tenant.
--
-- ## Why a function applies the policy
--
-- `app.apply_tenant_rls()` exists so that every tenant table gets the *identical* policy. Copying
-- four lines of DDL into each migration works until the day one copy says USING without
-- WITH CHECK — which reads fine, passes every read test, and lets a row be written into another
-- tenant. The catalog check (P06.02.04) would catch that; this stops it being written.

-- ---------------------------------------------------------------------------------------------
-- The tenant of the current transaction.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid
  LANGUAGE sql
  STABLE
  -- Not SECURITY DEFINER: it reads a transaction-local setting and must run as the caller.
  SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.organisation_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.current_org() IS
  'The organisation of the current transaction, or NULL when none is set. NULL makes every tenant policy match no rows (INV-02).';

GRANT EXECUTE ON FUNCTION app.current_org() TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- The one policy every tenant table gets.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app
AS $$
DECLARE
  policy_name text;
  has_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = target AND attname = 'organisation_id' AND NOT attisdropped
  ) INTO has_column;

  IF NOT has_column THEN
    RAISE EXCEPTION
      'table % has no organisation_id column, so it cannot carry a tenant policy. If it is deliberately global, add it to the register in docs/architecture/global-tables.md instead.',
      target;
  END IF;

  policy_name := format('%s_tenant_isolation', target::text);

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  -- FORCE is the half that is usually missed. Without it the policy does not apply to the table's
  -- owner, and the owner is who runs migrations, backfills and anything using an admin connection.
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, target);
  -- One policy for all commands: USING governs what is visible to SELECT, UPDATE and DELETE;
  -- WITH CHECK governs what may be written by INSERT and UPDATE. Both, always.
  EXECUTE format(
    'CREATE POLICY %I ON %s USING (organisation_id = app.current_org()) WITH CHECK (organisation_id = app.current_org())',
    policy_name, target
  );
END
$$;

COMMENT ON FUNCTION app.apply_tenant_rls(regclass) IS
  'Applies the single tenant policy: ENABLE + FORCE row-level security, USING and WITH CHECK against app.current_org(). Every tenant table uses this rather than its own copy.';

-- Only the migrator applies policies. Granting this to a runtime role would let it drop and
-- recreate the policy that constrains it.
REVOKE ALL ON FUNCTION app.apply_tenant_rls(regclass) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_tenant_rls(regclass) TO moin_migrator;
