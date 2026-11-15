-- 0083 — bound the authentication security event table (P06.12.02; security acceptance G11 M3).
--
-- ## What was wrong
--
-- `auth_security_events` had no retention at all, and every refused callback wrote a row without
-- authentication.
--
-- ## The change
--
-- `write_signin_event` (0024 body, replaced): each write sweeps up to 100 events older than one
-- year, the retention PLAN gives security logs (Data Protection: security logs, one year), going
-- through every event class so a class nobody writes any more is swept too. A `throttle` refusal
-- is written under a lock, once per source per minute and at most sixty a minute over all
-- sources: a refused flood cannot become a write flood, whatever digests it arrives under. The
-- P16 retention engine takes over the sweep.
--
-- No index is added: an index build would block writes on a table the sign-in path writes to.
-- Every query here is scoped to one event class and uses the existing (class, created_at) index.
-- The signature, owner, search path and EXECUTE grants are unchanged (CREATE OR REPLACE keeps
-- them); 0024 is not edited. The catalog's reviewed body digest moves to the new text.
--
-- The ceiling on `auth_throttle_buckets` is not part of this migration: counting the table under
-- a lock at saturation serialised every unknown source, so it is redesigned with an atomic
-- admission count as its own change (ROADMAP queue item X3).

CREATE OR REPLACE FUNCTION app.write_signin_event(
  p_outcome text,
  p_class text,
  p_reason_class text,
  p_source_digest bytea,
  p_is_new_family boolean DEFAULT false
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  -- All sources together store at most this many throttle refusals a minute: past the bucket
  -- ceiling every rotating source is refused under a digest of its own, and those rows are the
  -- ones an attacker makes without limit. The count of refusals lives in the buckets.
  c_max_throttle_events_per_minute CONSTANT integer := 60;
  v_budget integer := 100;
  v_deleted integer;
  v_class text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'refused') THEN
    RAISE EXCEPTION 'outcome must be accepted or refused' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_class IS NULL OR p_class NOT IN ('sign_in', 'step_up', 'throttle', 'revoke', 'mfa_change', 'password_change', 'new_device') THEN
    RAISE EXCEPTION 'unknown security event class' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason_class IS NULL OR p_reason_class NOT IN ('ok', 'callback', 'provider', 'token', 'identity', 'step_up', 'unavailable', 'rate_limited', 'reset') THEN
    RAISE EXCEPTION 'unknown reason class' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source_digest IS NULL OR octet_length(p_source_digest) <> 32 THEN
    RAISE EXCEPTION 'source must be a 32-byte digest' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- G11 M3: security events are kept for one year (PLAN: security logs, one year), and the
  -- table sweeps itself: up to 100 rows older than that go on every write, taken class by class
  -- so each delete uses the (class, created_at) index and a class nobody writes any more is still
  -- swept. Deletion keeps pace with insertion without a scheduler and without a new index (the
  -- retention engine of P16 takes this over).
  FOREACH v_class IN ARRAY ARRAY['sign_in', 'step_up', 'throttle', 'revoke', 'mfa_change', 'password_change', 'new_device'] LOOP
    EXIT WHEN v_budget <= 0;
    DELETE FROM public.auth_security_events
      WHERE ctid IN (
        SELECT ctid FROM public.auth_security_events
          WHERE class = v_class AND created_at < v_now - INTERVAL '1 year'
          LIMIT v_budget
      );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_budget := v_budget - v_deleted;
  END LOOP;
  IF p_class = 'throttle' THEN
    -- One writer of throttle refusals at a time, to the end of the transaction, so the two
    -- checks and the insert are one step and concurrent refusals cannot each see none.
    PERFORM pg_advisory_xact_lock(hashtext('signin-throttle-events'));
    v_now := clock_timestamp();
    IF EXISTS (
      SELECT 1 FROM public.auth_security_events e
        WHERE e.class = 'throttle' AND e.source_digest = p_source_digest
          AND e.created_at > v_now - INTERVAL '1 minute'
    ) OR (
      SELECT count(*) FROM public.auth_security_events e
        WHERE e.class = 'throttle' AND e.created_at > v_now - INTERVAL '1 minute'
    ) >= c_max_throttle_events_per_minute THEN
      RETURN;
    END IF;
  END IF;
  INSERT INTO public.auth_security_events
    (id, outcome, class, reason_class, source_digest, is_new_family, created_at)
    VALUES (gen_random_uuid(), p_outcome, p_class, p_reason_class, p_source_digest,
            COALESCE(p_is_new_family, false), v_now);
END
$$;
