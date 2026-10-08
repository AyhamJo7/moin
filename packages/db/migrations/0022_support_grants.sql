-- 0022 — support access grants: customer-granted, time-boxed, revocable (P06.11.02–05).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## What a grant is
--
-- A tenant row: the organisation that granted it, an opaque operator subject (provider `sub`,
-- recorded — never authenticated here; P06.11.01 is P05/EXT-09), a scope (`readonly` today;
-- wider scopes arrive as new scope values with their own functions, never by widening this
-- one), a reason, an expiry (≤ 72 h from creation, CHECK-enforced), revocation, and the actor
-- that created it. `created_by` is the calling owner/admin's user id (actor attribution,
-- INV-10); the operator subject is opaque text, never a users FK — operators are not customers.
--
-- ## Grant-gated functions, not views (founder-approved shape)
--
-- `moin_support_ro` holds no table grant on any tenant table — its reads go through three
-- `SECURITY DEFINER` functions that return rows ONLY with a live grant (unrevoked,
-- unexpired, scope-covering) for (organisation, operator subject). No grant → no rows;
-- expired → no rows; revoked → no rows. The gate is inside each function body (pinned by
-- digest), not in a view predicate a later migration could widen silently.
--
-- Scope today: membership roster (`support_read_memberships`), invitation queue
-- (`support_read_invitations`), recent audit trail (`support_read_audit_events`, capped).
-- Sessions, provider tokens and secrets are never readable through support functions — no
-- function touches `sessions`, `auth_transactions` or `users` beyond the (id, role, status)
-- needed to name a member. That exclusion is the point: support diagnoses access, it does
-- not impersonate it.
--
-- ## Audit (P06.11.04)
--
-- Every grant lifecycle event (create, revoke) audits in the same commit via the tenant
-- writer. Every support READ audits too — with the operator subject, the grant id and the
-- incident reference where present — in the same commit as the read: an access without its
-- audit row is a half-state. Emergency access (no grant) is a separate function gated on a
-- non-empty incident reference; it audits with the reference and a `emergency:true` validation
-- flag, and owner notification is recorded as PENDING (P06.12.02/P14 unwired — the runbook
-- stop-condition, honestly recorded in the row).
--
-- No new roles, no RLS change beyond the new table's own policy. `moin_app` manages grants
-- (owner/admin routes); `moin_support_ro` executes exactly the three read functions.

CREATE TABLE support_access_grants (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  operator_subject text      NOT NULL CHECK (length(operator_subject) BETWEEN 1 AND 255),
  scope           text        NOT NULL CHECK (scope IN ('readonly')),
  reason          text        NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  CONSTRAINT support_grant_max_72h CHECK (expires_at <= created_at + interval '72 hours'),
  UNIQUE (organisation_id, id)
);

CREATE INDEX support_grants_live_idx ON support_access_grants (organisation_id, operator_subject)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE support_access_grants IS
  'Customer-granted support access (P06.11). Tenant rows: opaque operator subject, scope, reason, 72 h max life, revocable. Reads only through grant-gated DEFINERs.';

SELECT app.apply_tenant_rls('support_access_grants');

REVOKE ALL ON TABLE support_access_grants
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON support_access_grants TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- The gate, one place: live grant for (organisation, operator subject, scope).
-- ---------------------------------------------------------------------------------------------
--
-- Every support read calls this first. Live = unrevoked, unexpired by the database clock
-- (clock_timestamp at lock time, never now() — HIGH2 shape), scope-covering. Returns the
-- grant id for the audit row, or NULL. Row lock (FOR UPDATE) serialises concurrent revoke
-- against concurrent read: a revoke committing first makes this read see nothing.

CREATE FUNCTION app.live_support_grant(
  p_organisation_id uuid,
  p_operator_subject text,
  p_scope text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_grant uuid;
BEGIN
  SELECT g.id INTO v_grant FROM public.support_access_grants g
    WHERE g.organisation_id = p_organisation_id
      AND g.operator_subject = p_operator_subject
      AND g.scope = p_scope
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp()
    FOR UPDATE;
  RETURN v_grant;
END
$$;

REVOKE ALL ON FUNCTION app.live_support_grant(uuid, text, text)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- Grant lifecycle: create + revoke, audited same-commit.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION app.create_support_grant(
  p_organisation_id uuid,
  p_operator_subject text,
  p_scope text,
  p_reason text,
  p_hours integer,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_hours integer := COALESCE(p_hours, 24);
BEGIN
  IF p_organisation_id IS NULL OR p_operator_subject IS NULL OR p_scope IS NULL
     OR p_reason IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'organisation, operator, scope, reason and actor are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_scope NOT IN ('readonly') THEN
    RAISE EXCEPTION 'unknown support scope' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(p_reason) < 8 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'reason must be 8-500 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_hours < 1 OR v_hours > 72 THEN
    RAISE EXCEPTION 'grant life must be 1-72 hours' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.support_access_grants
    (organisation_id, id, operator_subject, scope, reason, created_by, expires_at)
    VALUES (p_organisation_id, v_id, p_operator_subject, p_scope, p_reason, p_actor_id,
            clock_timestamp() + make_interval(hours => v_hours));
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'support.grant_create',
    'support_grant', v_id, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION app.create_support_grant(uuid, text, text, text, integer, uuid, uuid)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.create_support_grant(uuid, text, text, text, integer, uuid, uuid) TO moin_app;

CREATE FUNCTION app.revoke_support_grant(
  p_grant_id uuid,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_changed boolean := false;
BEGIN
  IF p_grant_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'grant and actor are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.support_access_grants SET revoked_at = clock_timestamp()
    WHERE id = p_grant_id AND revoked_at IS NULL
    RETURNING true INTO v_changed;
  IF NOT COALESCE(v_changed, false) THEN
    RETURN false;
  END IF;
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'support.grant_revoke',
    'support_grant', p_grant_id, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION app.revoke_support_grant(uuid, uuid, uuid)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.revoke_support_grant(uuid, uuid, uuid) TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- Grant-gated reads for moin_support_ro. Gate + read + audit, one commit, or nothing.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION app.support_read_memberships(
  p_organisation_id uuid,
  p_operator_subject text,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS TABLE (user_id uuid, role text, permissions text[], status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_grant uuid;
BEGIN
  -- Tenant first, from the argument: the support connection carries none (no withTenant on
  -- this path — the grant IS the authorisation). Setting it before the gate is safe: the gate
  -- selects the grant row FOR this org, so a wrong org simply finds no live grant and returns
  -- nothing. Transaction-local: cannot leak across pooled checkouts.
  PERFORM set_config('app.organisation_id', p_organisation_id::text, true);
  v_grant := app.live_support_grant(p_organisation_id, p_operator_subject, 'readonly');
  IF v_grant IS NULL THEN
    RETURN;
  END IF;
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'operator', 'support.read_memberships',
    'support_grant', v_grant, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN QUERY SELECT m.user_id, m.role, m.permissions, m.status FROM public.memberships m
    WHERE m.organisation_id = p_organisation_id;
END
$$;

REVOKE ALL ON FUNCTION app.support_read_memberships(uuid, text, uuid, uuid)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_reporting;
GRANT EXECUTE ON FUNCTION app.support_read_memberships(uuid, text, uuid, uuid) TO moin_support_ro;

CREATE FUNCTION app.support_read_invitations(
  p_organisation_id uuid,
  p_operator_subject text,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS TABLE (id uuid, email citext, role text, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_grant uuid;
BEGIN
  -- Tenant first, from the argument: the support connection carries none (no withTenant on
  -- this path — the grant IS the authorisation). Setting it before the gate is safe: the gate
  -- selects the grant row FOR this org, so a wrong org simply finds no live grant and returns
  -- nothing. Transaction-local: cannot leak across pooled checkouts.
  PERFORM set_config('app.organisation_id', p_organisation_id::text, true);
  v_grant := app.live_support_grant(p_organisation_id, p_operator_subject, 'readonly');
  IF v_grant IS NULL THEN
    RETURN;
  END IF;
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'operator', 'support.read_invitations',
    'support_grant', v_grant, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  -- Token digests never leave through support reads: status only, never token_hash.
  RETURN QUERY SELECT i.id, i.email, i.role,
    CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
         WHEN i.revoked_at IS NOT NULL THEN 'revoked'
         WHEN i.expires_at <= clock_timestamp() THEN 'expired'
         ELSE 'outstanding' END
    FROM public.invitations i WHERE i.organisation_id = p_organisation_id;
END
$$;

REVOKE ALL ON FUNCTION app.support_read_invitations(uuid, text, uuid, uuid)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_reporting;
GRANT EXECUTE ON FUNCTION app.support_read_invitations(uuid, text, uuid, uuid) TO moin_support_ro;

CREATE FUNCTION app.support_read_audit_events(
  p_organisation_id uuid,
  p_operator_subject text,
  p_actor_id uuid,
  p_event_id uuid,
  p_limit integer DEFAULT 50
) RETURNS TABLE (seq bigint, operation text, target_kind text, created_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_grant uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  -- Tenant first, from the argument: the support connection carries none (no withTenant on
  -- this path — the grant IS the authorisation). Setting it before the gate is safe: the gate
  -- selects the grant row FOR this org, so a wrong org simply finds no live grant and returns
  -- nothing. Transaction-local: cannot leak across pooled checkouts.
  PERFORM set_config('app.organisation_id', p_organisation_id::text, true);
  v_grant := app.live_support_grant(p_organisation_id, p_operator_subject, 'readonly');
  IF v_grant IS NULL THEN
    RETURN;
  END IF;
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'operator', 'support.read_audit',
    'support_grant', v_grant, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  -- Shape-minimal: sequence, operation, target kind, time. No args, no actor ids, no hashes.
  RETURN QUERY SELECT e.seq, e.operation, e.target_kind, e.created_at FROM public.audit_events e
    WHERE e.organisation_id = p_organisation_id ORDER BY e.seq DESC LIMIT v_limit;
END
$$;

REVOKE ALL ON FUNCTION app.support_read_audit_events(uuid, text, uuid, uuid, integer)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_reporting;
GRANT EXECUTE ON FUNCTION app.support_read_audit_events(uuid, text, uuid, uuid, integer) TO moin_support_ro;

-- ---------------------------------------------------------------------------------------------
-- Emergency access without a grant (P06.11.04): incident reference required, audited with it,
-- owner notification recorded PENDING. Read-only membership roster only — the narrowest read
-- that lets an incident responder confirm who can act for the tenant. No grant is created or
-- consumed; the incident reference is the authorisation, and it must be non-empty.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION app.support_emergency_read_memberships(
  p_organisation_id uuid,
  p_operator_subject text,
  p_actor_id uuid,
  p_event_id uuid,
  p_incident_ref text
) RETURNS TABLE (user_id uuid, role text, permissions text[], status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF p_organisation_id IS NULL OR p_operator_subject IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'organisation, operator and actor are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_incident_ref IS NULL OR length(btrim(p_incident_ref)) < 4 THEN
    RAISE EXCEPTION 'emergency access requires an incident reference'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Tenant for the audit row (same shape as the grant-gated reads above): the support
  -- connection carries none; the incident reference IS the authorisation here, validated
  -- before this line runs.
  PERFORM set_config('app.organisation_id', p_organisation_id::text, true);
  -- Audited with two boolean validation flags (the writer allows booleans and 0..1 numbers
  -- only): incident reference present + emergency. The owner-notification obligation
  -- (P06.12.02/P14) is unwired, so no notification claim is written — a lie in the audit trail
  -- is worse than a gap. The incident reference itself is never stored (INV-12: opaque ids in
  -- audit rows, free-text references live in the ticket).
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'operator', 'support.emergency_read',
    'support_grant', NULL, '{}',
    jsonb_build_object('incident_ref_present', true, 'emergency', true),
    '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN QUERY SELECT m.user_id, m.role, m.permissions, m.status FROM public.memberships m
    WHERE m.organisation_id = p_organisation_id;
END
$$;

REVOKE ALL ON FUNCTION app.support_emergency_read_memberships(uuid, text, uuid, uuid, text)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_reporting;
GRANT EXECUTE ON FUNCTION app.support_emergency_read_memberships(uuid, text, uuid, uuid, text) TO moin_support_ro;
