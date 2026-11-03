-- 0080 — support grant integrity (P06.11.02, INV-10; security acceptance G10 M1 to M4).
--
-- ## What was wrong (independent review of EV-P06-057, main 3ac126e)
--
-- M1. `moin_app` held INSERT and UPDATE on `support_access_grants` (0022). Under a tenant
--     context it could insert a grant, un-revoke one, or move `created_at` and `expires_at`
--     about 1000 days out, with no audit row. The grant gate trusts that table.
-- M2. The cap of five live grants per organisation (0028) is an unlocked count then insert at
--     READ COMMITTED: twelve parallel creates left ten live grants and two 500s.
-- M3. `hours: 72` always failed: `expires_at` used `clock_timestamp()` while `created_at`
--     defaulted to `now()`, so `support_grant_max_72h` broke by the elapsed microseconds.
-- M4. Creating a grant for an operator that already had a live one revoked the old row with no
--     audit event.
--
-- ## The change
--
-- M1. INSERT and UPDATE on the table are revoked from `moin_app`; it keeps SELECT for the
--     listing route. Every write goes through the DEFINER functions `create_support_grant` and
--     `revoke_support_grant`, which audit in the same commit.
-- M2. `create_support_grant` takes `pg_advisory_xact_lock(hashtext('support_grant:' || org))`
--     before it counts.
-- M3. One `clock_timestamp()` supplies both `created_at` and `expires_at`.
-- M4. Each superseded grant gets its own `support.grant_revoke` audit event in the commit.
--
-- Not changed here (G10 M5): operator identity in the read audit rows needs a trusted operator
-- session, which is P06.11.01 (P05/EXT-09). No runtime role may EXECUTE a support read until it
-- exists, and that stays true.
--
-- Privilege reduction plus a function body replacement (`CREATE OR REPLACE` keeps the
-- signature, owner and EXECUTE grants); no table, column or data change. The catalog's
-- reviewed body digest moves to the new text.

REVOKE INSERT, UPDATE ON TABLE support_access_grants FROM moin_app;

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
  v_now timestamptz;
  v_superseded uuid;
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
  -- G10 M2: the cap is a check-then-insert, so two creates for one organisation must not
  -- interleave. One advisory lock per organisation, taken before the count and held to commit;
  -- its own keyspace (`support_grant:`), disjoint from the other advisory locks.
  PERFORM pg_advisory_xact_lock(hashtext('support_grant:' || p_organisation_id::text));
  -- M1: at most 5 live grants per (organisation, scope) — counts live rows only.
  SELECT count(*) INTO v_live FROM public.support_access_grants g
    WHERE g.organisation_id = p_organisation_id
      AND g.scope = p_scope
      AND g.revoked_at IS NULL
      AND g.expires_at > clock_timestamp();
  IF v_live >= 5 THEN
    RAISE EXCEPTION 'grant quota exceeded for tenant'
      USING ERRCODE = 'P0001';
  END IF;
  -- H1 (second half): supersede prior live grants for the same operator+scope so no
  -- stale row can shadow the new one. G10 M4: each superseded grant gets its own revoke audit
  -- event in this commit (INV-10): a grant that stops working without a row saying so is a
  -- silent state change.
  FOR v_superseded IN
    UPDATE public.support_access_grants SET revoked_at = clock_timestamp()
      WHERE organisation_id = p_organisation_id
        AND operator_subject = p_operator_subject
        AND scope = p_scope
        AND revoked_at IS NULL
      RETURNING id
  LOOP
    PERFORM app.append_audit_event(
      gen_random_uuid(), p_actor_id, 'api', 'support.grant_revoke',
      'support_grant', v_superseded, '{}', '{}', '{}', 'succeeded', NULL,
      NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
    );
  END LOOP;
  -- G10 M3: created_at and expires_at come from one instant. created_at defaulted to now()
  -- (transaction start) while expires_at used clock_timestamp(), so the documented maximum of
  -- 72 hours always broke support_grant_max_72h by the elapsed microseconds.
  v_now := clock_timestamp();
  INSERT INTO public.support_access_grants
    (organisation_id, id, operator_subject, scope, reason, created_by, created_at, expires_at)
    VALUES (p_organisation_id, v_id, p_operator_subject, p_scope, p_reason, p_actor_id, v_now,
            v_now + make_interval(hours => v_hours));
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'support.grant_create',
    'support_grant', v_id, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN v_id;
END
$$;
