-- 0083 — bound the authentication throttle and security event tables (P06.12.01, P06.12.02;
-- security acceptance G11 M3).
--
-- ## What was wrong
--
-- `auth_throttle_buckets` was bounded only by a day of distinct sources: a rotating scanner made
-- the table as large as it wanted for a day, and each fresh bucket let it write refused sign-in
-- events without limit. `auth_security_events` had no retention at all.
--
-- ## The change
--
-- `auth_throttle_admission` holds the number of live buckets in one row. `take_signin_bucket`
-- (0023 body, replaced) admits a new source by one conditional update of that row, which either
-- takes a slot under the ceiling of 50 000 or matches nothing: there is no count of the table,
-- and at the ceiling an unknown source reads one row and takes no lock on it. A source without a
-- slot shares the scope's overflow bucket (the all-zero digest), so rotating sources can neither
-- grow the table nor buy fresh budgets, and their refused sign-ins are limited by that one shared
-- budget. A source with a row pays nothing extra. The request locks its own row before it reads
-- it, and the sweep skips locked rows and returns their slots, so a bucket in use is never swept
-- from under its request and the count follows the table.
--
-- `write_signin_event` (0024 body, replaced): each write sweeps up to 100 events older than one
-- year, the retention PLAN gives security logs (Data Protection: security logs, one year), going
-- through every event class so a class nobody writes any more is swept too. A `throttle` refusal
-- is written under a lock, once per source per minute and at most sixty a minute over all
-- sources: a refused flood cannot become a write flood. The P16 retention engine takes over the
-- sweep.
--
-- No index is added to an existing table: an index build would block writes on a table the
-- sign-in path writes to. The event queries are scoped to one class and use the existing
-- (class, created_at) index. Signatures, owners, search paths and EXECUTE grants are unchanged
-- (CREATE OR REPLACE keeps them); 0023 and 0024 are not edited. The catalog's reviewed body
-- digests move to the new text.

CREATE TABLE auth_throttle_admission (
  singleton    boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (singleton),
  live_buckets integer NOT NULL CHECK (live_buckets >= 0)
);

COMMENT ON TABLE auth_throttle_admission IS
  'The number of rows in auth_throttle_buckets, kept by take_signin_bucket so a new source is admitted by one conditional update instead of a count of the table (P06.12.01). Global, one row, no identity.';

INSERT INTO auth_throttle_admission (singleton, live_buckets)
  SELECT true, count(*) FROM auth_throttle_buckets;

REVOKE ALL ON TABLE auth_throttle_admission
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

CREATE OR REPLACE FUNCTION app.take_signin_bucket(
  p_scope text,
  p_key_digest bytea,
  p_capacity double precision,
  p_refill_per_second double precision,
  p_cost double precision
) RETURNS TABLE (allowed boolean, retry_after_ms integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_tokens double precision;
  v_updated timestamptz;
  v_now timestamptz := clock_timestamp();
  v_key bytea := p_key_digest;
  v_exists boolean;
  v_swept integer;
  -- G11 M3: the table never holds more than this many buckets plus the overflow bucket of each
  -- scope. A new source that finds no slot shares its scope's overflow bucket (the all-zero
  -- digest), so a rotating scanner cannot grow the table and cannot buy itself fresh budgets.
  c_max_buckets CONSTANT integer := 50000;
  c_overflow CONSTANT bytea := '\x0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('ip', 'account') THEN
    RAISE EXCEPTION 'throttle scope must be ip or account' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_key_digest IS NULL OR octet_length(p_key_digest) <> 32 THEN
    RAISE EXCEPTION 'bucket key must be a 32-byte digest' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_capacity IS NULL OR p_capacity <= 0 OR p_capacity > 100000
     OR p_refill_per_second IS NULL OR p_refill_per_second < 0
     OR p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'bucket parameters out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':' || encode(p_key_digest, 'hex')));
  -- Opportunistic sweep: rows untouched for over a day are dead weight (their bucket would
  -- refill full long before). Capped at 100 per call — bounded cost on the request path. A row
  -- another request holds is skipped, never waited for, and every swept row returns its slot.
  DELETE FROM public.auth_throttle_buckets
    WHERE ctid IN (
      SELECT ctid FROM public.auth_throttle_buckets
        WHERE updated_at < v_now - INTERVAL '24 hours'
        LIMIT 100
        FOR UPDATE SKIP LOCKED
    );
  GET DIAGNOSTICS v_swept = ROW_COUNT;
  IF v_swept > 0 THEN
    UPDATE public.auth_throttle_admission
      SET live_buckets = GREATEST(0, live_buckets - v_swept);
  END IF;
  -- This source's own row, locked before it is read: from here on no sweep can remove it.
  SELECT true INTO v_exists FROM public.auth_throttle_buckets b
    WHERE b.scope = p_scope AND b.key_digest = v_key FOR UPDATE;
  IF v_exists IS NULL THEN
    -- A new source takes a slot only while one is free. The update is the admission: it either
    -- raises the count below the ceiling or matches nothing, with no count of the table.
    UPDATE public.auth_throttle_admission
      SET live_buckets = live_buckets + 1 WHERE live_buckets < c_max_buckets;
    IF NOT FOUND THEN
      v_key := c_overflow;
      PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':' || encode(v_key, 'hex')));
      SELECT true INTO v_exists FROM public.auth_throttle_buckets b
        WHERE b.scope = p_scope AND b.key_digest = v_key FOR UPDATE;
      IF v_exists IS NULL THEN
        -- The overflow bucket itself is a row like any other for the count.
        UPDATE public.auth_throttle_admission SET live_buckets = live_buckets + 1;
      END IF;
    END IF;
  END IF;
  -- Refill against the STORED capacity (the ceiling that earned the current balance), then
  -- adopt the caller's capacity for the take below: a caller passing a SMALLER capacity than
  -- stored must not shrink the balance it never earned, and a caller passing a LARGER one
  -- must not inflate past what the stored ceiling allowed. The take clamps to the caller's
  -- capacity afterwards, so budgets stay caller-controlled without balance smuggling.
  INSERT INTO public.auth_throttle_buckets AS b
    (scope, key_digest, tokens, capacity, refill_per_second, updated_at)
    VALUES (p_scope, v_key, p_capacity, p_capacity, p_refill_per_second, v_now)
  ON CONFLICT (scope, key_digest) DO UPDATE
    SET tokens = LEAST(b.capacity,
                       b.tokens + b.refill_per_second *
                         EXTRACT(EPOCH FROM (v_now - b.updated_at))),
        capacity = p_capacity,
        refill_per_second = p_refill_per_second,
        updated_at = v_now
  RETURNING LEAST(b.tokens, p_capacity), b.updated_at INTO v_tokens, v_updated;
  IF v_tokens >= p_cost THEN
    UPDATE public.auth_throttle_buckets SET tokens = v_tokens - p_cost
      WHERE scope = p_scope AND key_digest = v_key;
    RETURN QUERY SELECT true, 0;
  ELSE
    RETURN QUERY SELECT false,
      GREATEST(0, CEIL(((p_cost - v_tokens) / NULLIF(p_refill_per_second, 0)) * 1000))::integer;
  END IF;
END
$$;

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
