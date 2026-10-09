-- 0028 — support grant gate hardening: deterministic live-grant pick, creation-time
-- supersede, per-tenant cap, shared read locks (P06.11 H1/H2/M1/M2).
-- migration-check: allow create-index-blocking because no statement below creates an
-- index; every statement touches only grant rows.
--
-- ## What was wrong (QG-09 §9, EV-P06-074)
--
-- H1: `app.live_support_grant` picked an arbitrary live row (`SELECT ... INTO` with no
-- ORDER BY and no expiry predicate): an expired-but-unrevoked older grant could shadow a
-- valid newer one and the operator was locked out despite holding a live grant. Fix:
-- expiry predicate in the pick plus deterministic order
-- (`ORDER BY expires_at DESC, created_at DESC, id LIMIT 1`), plus creation-time
-- supersede below so at most one live row normally exists per operator+scope.
-- H2: `app.support_emergency_read_memberships` authorises on a 4-char incident string
-- with no operator identity check. EXECUTE remains withheld from every runtime role
-- until P06.11.01, but the incident reference is now bound to the operator subject:
-- format `op:<subject>:<ticket>` where `<subject>` must equal `p_operator_subject`
-- and the ticket is at least 4 chars. A dummy string for another operator refuses.
-- M1: no cap on concurrent live grants per tenant. Fix: at most 5 live grants per
-- (organisation, scope); the 6th create refuses (`grant_quota_exceeded`).
-- M2: the gate took `FOR UPDATE` on every support read, serialising concurrent
-- diagnostic reads against each other. Fix: `FOR SHARE` — concurrent reads share the
-- picked row lock and proceed in parallel; a concurrent revoke (`UPDATE ... SET
-- revoked_at`) still waits on the shared locks, so revoke-then-read stays ordered.
-- Expiry is judged in the pick predicate at lock time (same HIGH2 shape as before).
--
-- No signature, owner, grant or search_path change. Catalog REVIEWED_BODIES digests
-- move to the new texts (see the catalog change in this PR).

-- ---------------------------------------------------------------------------------------------
-- 1. live_support_grant: deterministic pick, shared lock.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.live_support_grant(
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
  -- Deterministic pick (H1): live rows only, newest expiry wins. Shared lock (M2):
  -- readers proceed in parallel; a concurrent revoke waits.
  SELECT g.id INTO v_grant FROM public.support_access_grants g
    WHERE g.organisation_id = p_organisation_id
      AND g.operator_subject = p_operator_subject
      AND g.scope = p_scope
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp()
    ORDER BY g.expires_at DESC, g.created_at DESC, g.id
    LIMIT 1
    FOR SHARE;
  RETURN v_grant;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. create_support_grant: supersede prior live grants + per-tenant cap (H1/M1).
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.create_support_grant(
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
  v_live integer;
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
  -- M1: at most 5 live grants per (organisation, scope) — counts live rows only.
  SELECT count(*) INTO v_live FROM public.support_access_grants g
    WHERE g.organisation_id = p_organisation_id
      AND g.scope = p_scope
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp();
  IF v_live >= 5 THEN
    RAISE EXCEPTION 'grant quota exceeded for tenant'
      USING ERRCODE = 'grant_quota_exceeded';
  END IF;
  -- H1 (second half): supersede prior live grants for the same operator+scope so no
  -- stale row can shadow the new one.
  UPDATE public.support_access_grants SET revoked_at = clock_timestamp()
    WHERE organisation_id = p_organisation_id
      AND operator_subject = p_operator_subject
      AND scope = p_scope
      AND revoked_at IS NULL;
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

-- ---------------------------------------------------------------------------------------------
-- 3. support_emergency_read_memberships: bind the incident reference to the operator (H2).
-- ---------------------------------------------------------------------------------------------
-- EXECUTE stays withheld from every runtime role (see REVOKE below, unchanged): the body
-- hardening matters the day P06.11.01 grants it. Format `op:<subject>:<ticket>` with
-- `<subject> = p_operator_subject` and `length(ticket) >= 4`. Anything else refuses.

CREATE OR REPLACE FUNCTION app.support_emergency_read_memberships(
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
  -- H2: the incident reference must name this operator: `op:<subject>:<ticket>`.
  IF p_incident_ref IS NULL
     OR p_incident_ref NOT LIKE 'op:%'
     OR split_part(p_incident_ref, ':', 2) != p_operator_subject
     OR length(COALESCE(split_part(p_incident_ref, ':', 3), '')) < 4 THEN
    RAISE EXCEPTION 'emergency access requires an incident reference bound to the operator'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.organisation_id', p_organisation_id::text, true);
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
-- P06.11.01 gates this: no EXECUTE until the trusted operator identity check exists.
-- GRANT EXECUTE ... TO moin_support_ro;  -- PENDING P06.11.01
