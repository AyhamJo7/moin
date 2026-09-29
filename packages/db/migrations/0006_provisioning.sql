-- 0006 — tenant provisioning (P06.04, ADR-0003, INV-01, INV-02, INV-18).
--
-- ## Why this is a function and not an INSERT
--
-- Creating a tenant is the one write that legitimately precedes the existence of the tenant it
-- writes for, so it cannot happen inside `withTenant` the way everything else does. That makes it
-- the natural place to put a hole in the isolation model, and the point of this file is that there
-- is no hole.
--
-- Three things have to be true at once, and none of them can be enforced by a caller holding
-- INSERT on `organisations`:
--
--   * **the Early Access cap** must hold under concurrency, not merely be checked;
--   * **the same request twice must produce one tenant**, not two;
--   * **a half-built tenant must never survive** a failure.
--
-- A `SECURITY DEFINER` function is how all three become properties of the database rather than
-- promises of the caller. `moin_provisioner` gets `EXECUTE` on it and **no DML at all** on the
-- tables it writes, so the only way that role can create a tenant is the way that enforces the
-- rules.
--
-- ## It does not bypass row-level security. It satisfies it.
--
-- The obvious implementation gives the function's owner `BYPASSRLS`, or disables FORCE on
-- `organisations`. Both would make provisioning the one path where isolation does not apply — and
-- the path that runs before any tenant exists is exactly where a mistake is least visible.
--
-- Instead the function **sets the tenant context to the organisation it is about to create**, and
-- then inserts under the ordinary policy. `organisations.organisation_id` is generated from `id`,
-- so the policy's `organisation_id = app.current_org()` is satisfied by construction. The child
-- rows are then written in the same transaction, under the same context, under the same policies
-- every other write in the system obeys.
--
-- No role gains `BYPASSRLS`. FORCE stays on. The catalog check (P06.02.04) still passes, and it
-- would fail if any of that were quietly undone.
--
-- ## Atomicity
--
-- A function call is a single statement, so everything here commits or none of it does. There is
-- no interleaving in which an organisation exists without its first location, and no failure that
-- leaves a tenant a caller could partially use.

-- ---------------------------------------------------------------------------------------------
-- The cap, as data rather than as a literal.
-- ---------------------------------------------------------------------------------------------
--
-- PLAN caps Early Access at five paid organisations until the P30 pentest is complete, and says an
-- override needs a founder-signed flag change that is audited. In this repository a migration *is*
-- that: it is reviewed in a pull request, merged by the founder, and recorded permanently in the
-- history. A runtime-editable setting would be neither signed nor audited, and a literal in the
-- function body would be neither visible nor changeable without a deploy.
--
-- Single row by construction: `ck_single_row` makes a second row impossible, so "which limit
-- applies" can never become a question.
CREATE TABLE provisioning_limits (
  id                  boolean     NOT NULL PRIMARY KEY DEFAULT true CHECK (id),
  early_access_cap    integer     NOT NULL CHECK (early_access_cap >= 0),
  reason              text        NOT NULL CHECK (length(btrim(reason)) > 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE provisioning_limits IS
  'The Early Access cap. One row, changed only by a reviewed migration, which is what makes a change to it signed and audited (P06.04.03).';

INSERT INTO provisioning_limits (early_access_cap, reason)
VALUES (5, 'PLAN P06.04.03: at most five Early Access organisations until the P30 penetration test is complete.');

-- ---------------------------------------------------------------------------------------------
-- Idempotency.
-- ---------------------------------------------------------------------------------------------
--
-- The caller supplies a request id. A retry after a timeout — the case that actually happens —
-- must return the tenant the first attempt created rather than creating a second one, and the
-- UNIQUE constraint is what makes that true even if two retries race.
CREATE TABLE provisioning_requests (
  request_id      uuid        NOT NULL PRIMARY KEY,
  organisation_id uuid        NOT NULL REFERENCES organisations (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE provisioning_requests IS
  'One row per accepted provisioning request. Makes provision_tenant idempotent per request id (P06.04.04).';

-- ---------------------------------------------------------------------------------------------
-- Provisioning.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.provision_tenant(
  p_request_id     uuid,
  p_slug           citext,
  p_name           text,
  p_location_name  text,
  p_early_access   boolean DEFAULT false,
  p_time_zone      text    DEFAULT 'Europe/Berlin'
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  -- Pinned: an elevated function with a caller-controlled search_path lets the caller choose which
  -- `public.foo()` it resolves to, which is the standard privilege-escalation primitive.
  SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_existing uuid;
  v_org_id   uuid;
  v_cap      integer;
  v_count    integer;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'provision_tenant requires a request id, so that a retry cannot create a second tenant';
  END IF;

  -- Idempotency first: a retry must not even reach the cap check, or a retry after the cap filled
  -- would fail where the original succeeded.
  SELECT organisation_id INTO v_existing
  FROM provisioning_requests WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Serialise provisioning. Without this, two concurrent callers both read four and both insert,
  -- and the cap is a suggestion. The lock is transaction-scoped and released on commit or abort.
  PERFORM pg_advisory_xact_lock(hashtext('moin.provision_tenant'));

  -- Re-read after taking the lock: another transaction may have committed this request while we
  -- waited, and returning its organisation is more correct than raising a unique violation.
  SELECT organisation_id INTO v_existing
  FROM provisioning_requests WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF p_early_access THEN
    SELECT early_access_cap INTO v_cap FROM provisioning_limits;
    IF v_cap IS NULL THEN
      RAISE EXCEPTION 'provisioning_limits is empty; the Early Access cap is unknown and provisioning fails closed';
    END IF;
    SELECT count(*) INTO v_count FROM organisations
    WHERE early_access AND status <> 'deleted';
    IF v_count >= v_cap THEN
      RAISE EXCEPTION
        'Early Access cap reached: % of % organisations. Raising it is a migration against provisioning_limits, which is reviewed and recorded (P06.04.03).',
        v_count, v_cap
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_org_id := gen_random_uuid();

  -- The tenant context is set to the organisation about to be created, so every insert below runs
  -- under the ordinary policy rather than around it. This is the line that keeps provisioning
  -- inside the isolation model instead of beside it.
  PERFORM set_config('app.organisation_id', v_org_id::text, true);

  INSERT INTO organisations (id, slug, name, status, time_zone, early_access)
  VALUES (v_org_id, p_slug, p_name, 'trial', p_time_zone, p_early_access);

  INSERT INTO locations (organisation_id, id, name, time_zone)
  VALUES (v_org_id, gen_random_uuid(), p_location_name, p_time_zone);

  INSERT INTO provisioning_requests (request_id, organisation_id)
  VALUES (p_request_id, v_org_id);

  RETURN v_org_id;
END
$$;

COMMENT ON FUNCTION app.provision_tenant(uuid, citext, text, text, boolean, text) IS
  'Creates one tenant atomically and idempotently, under the ordinary row-level-security policy rather than around it. The only sanctioned way to create an organisation (P06.04.02).';

-- `moin_provisioner` may execute it and has no DML on what it writes, so the rules above are the
-- only way that role can create a tenant.
REVOKE ALL ON FUNCTION app.provision_tenant(uuid, citext, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_tenant(uuid, citext, text, text, boolean, text)
  TO moin_provisioner;

-- Read-only visibility for the roles that need to reason about provisioning; no writes anywhere.
GRANT SELECT ON TABLE provisioning_limits TO moin_app, moin_provisioner, moin_support_ro, moin_reporting;
GRANT SELECT ON TABLE provisioning_requests TO moin_provisioner, moin_support_ro;
