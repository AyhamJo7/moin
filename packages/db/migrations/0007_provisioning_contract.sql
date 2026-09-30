-- P06.04: complete the provisioning contract before the first release of this branch.
-- The preceding checkpoint migration has been applied on one developer database. Keep its
-- checksum stable and correct it here so both that database and fresh installs converge.

-- This is global idempotency bookkeeping, looked up before tenant context exists. Calling its
-- reference organisation_id fooled the tenant-table catalog rule; the name must reflect scope.
-- migration-check: allow rename because 0006 is an unmerged checkpoint with no released reader; only one developer database has applied it.
ALTER TABLE provisioning_requests RENAME COLUMN organisation_id TO tenant_id;
ALTER TABLE provisioning_limits ADD COLUMN accepted_paid_early_access integer NOT NULL DEFAULT 0
  CHECK (accepted_paid_early_access >= 0);

-- 0003's default grants are a safety net for migrator-owned tables. Explicitly remove them on
-- all provisioning objects: in production these are owned by migrator, unlike the local template.
REVOKE ALL ON organisations, provisioning_limits, provisioning_requests FROM
  moin_app, moin_provisioner, moin_support_ro, moin_reporting;
REVOKE SELECT ON schema_migrations FROM moin_provisioner;
REVOKE EXECUTE ON FUNCTION app.current_org() FROM moin_provisioner;
-- In particular, the application cannot rewrite plan_code, early_access or status to evade the
-- cap. Lifecycle changes will need a separate reviewed path when that phase arrives.
GRANT SELECT ON organisations TO moin_app;

ALTER TABLE organisations ADD COLUMN plan_code text NOT NULL DEFAULT 'pilot'
  CHECK (plan_code IN ('pilot', 'reception', 'front_office'));
-- Until the P30 cap-lift migration, every paid tenant must be Early Access. A caller cannot
-- choose early_access=false to evade the cap.
ALTER TABLE organisations ADD CONSTRAINT paid_requires_early_access
  CHECK (plan_code = 'pilot' OR early_access) NOT VALID;
ALTER TABLE organisations VALIDATE CONSTRAINT paid_requires_early_access;

-- The binding and policy are data scoped to the tenant, under the standard FORCE RLS template.
CREATE TABLE tenant_setup (
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_ref text NOT NULL CHECK (template_ref ~ '^[a-z][a-z0-9_-]{0,63}@[0-9]+[.][0-9]+$'),
  retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 30 AND 365),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id)
);
SELECT app.apply_tenant_rls('tenant_setup');
REVOKE ALL ON tenant_setup FROM moin_app;
GRANT SELECT ON tenant_setup TO moin_app;

-- Invitation issuance and delivery belong to P06.08. Provisioning records one pending owner
-- invitation, atomically, so no tenant can be created without an owner onboarding request.
CREATE TABLE owner_invitation_requests (
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'issued', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id)
);
SELECT app.apply_tenant_rls('owner_invitation_requests');
REVOKE ALL ON owner_invitation_requests FROM moin_app;
GRANT SELECT ON owner_invitation_requests TO moin_app;

DROP FUNCTION app.provision_tenant(uuid, citext, text, text, boolean, text);

CREATE FUNCTION app.provision_tenant(
  p_request_id uuid,
  p_slug citext,
  p_name text,
  p_location_name text,
  p_owner_email text,
  p_template_ref text DEFAULT 'restaurant@1.0',
  p_plan_code text DEFAULT 'pilot',
  p_early_access boolean DEFAULT false,
  p_time_zone text DEFAULT 'Europe/Berlin'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  -- Explicit pg_temp last: otherwise a caller's TEMP table can shadow an unqualified public table.
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_org_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_slug IS NULL OR p_slug::text !~ '^[a-z][a-z0-9-]{2,62}$'
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_location_name IS NULL OR length(btrim(p_location_name)) NOT BETWEEN 1 AND 200
    OR p_owner_email IS NULL OR p_owner_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    OR length(p_owner_email) > 254
    OR p_template_ref IS NULL OR p_template_ref !~ '^[a-z][a-z0-9_-]{0,63}@[0-9]+[.][0-9]+$'
    OR p_plan_code IS NULL OR p_plan_code NOT IN ('pilot', 'reception', 'front_office')
    OR p_early_access IS NULL OR p_time_zone IS NULL OR length(p_time_zone) NOT BETWEEN 1 AND 64
    OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_time_zone)
  THEN
    RAISE EXCEPTION 'invalid provisioning request' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Serialize the authoritative count, retry check and all inserts in one transaction.
  PERFORM pg_advisory_xact_lock(hashtext('moin.provision_tenant'));
  SELECT tenant_id INTO v_existing FROM provisioning_requests WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_existing; END IF;

  IF p_plan_code <> 'pilot' THEN
    IF NOT p_early_access THEN
      RAISE EXCEPTION 'paid provisioning requires Early Access until P30'
        USING ERRCODE = 'check_violation';
    END IF;
    -- A FORCE RLS role cannot count other tenants, even as this definer. The single global
    -- counter is the authority. UPDATE takes its row lock, checks the boundary and increments
    -- in this same transaction; rollback undoes the increment with all tenant state.
    UPDATE provisioning_limits
      SET accepted_paid_early_access = accepted_paid_early_access + 1,
          updated_at = now()
      WHERE id AND accepted_paid_early_access < early_access_cap;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Early Access cap reached' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_org_id := gen_random_uuid();
  PERFORM set_config('app.organisation_id', v_org_id::text, true);
  INSERT INTO organisations(id, slug, name, status, time_zone, early_access, plan_code)
    VALUES (v_org_id, p_slug, p_name, 'trial', p_time_zone, p_early_access, p_plan_code);
  INSERT INTO locations(organisation_id, id, name, time_zone)
    VALUES (v_org_id, gen_random_uuid(), p_location_name, p_time_zone);
  INSERT INTO tenant_setup(organisation_id, template_ref)
    VALUES (v_org_id, p_template_ref);
  INSERT INTO owner_invitation_requests(organisation_id, email)
    VALUES (v_org_id, lower(p_owner_email));
  INSERT INTO provisioning_requests(request_id, tenant_id)
    VALUES (p_request_id, v_org_id);
  RETURN v_org_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'provisioning identifier already in use' USING ERRCODE = 'unique_violation';
END
$$;

REVOKE ALL ON FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
  TO moin_provisioner;
COMMENT ON FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
  IS 'QG-09: atomic, capped, idempotent tenant setup; moin_provisioner only; FORCE RLS retained.';
