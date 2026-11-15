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
-- **The count.** `auth_throttle_admission` holds the number of live buckets in one row, kept by
-- two statement triggers on the bucket table, so every writer keeps it right: the new function,
-- a call of the previous body that was in flight when this migration committed, a fixture. The
-- migration takes a write-blocking lock on the bucket table before it creates the triggers and
-- seeds the count, so no write falls between the two.
--
-- **Admission.** `take_signin_bucket` (0023 body, replaced) lets a source that has a bucket go
-- straight to it: no count, no shared lock, no sweep. A source without one is admitted by one
-- conditional update of the count row, which either reserves a slot under the ceiling of 50 000
-- or matches nothing. At the ceiling it tries, without waiting, to be the one request that
-- sweeps; if stale buckets go, it takes a freed slot; otherwise it shares its scope's overflow
-- bucket (the all-zero digest, never counted and never swept). Rotating sources can therefore
-- neither grow the table nor buy fresh budgets, and their refused sign-ins are limited by that
-- one shared budget.
--
-- **Lock order.** A request locks its own source first (the advisory lock 0023 already takes),
-- then at most the count row, and after that waits for nothing but the overflow source, whose
-- holder never waits for the count row. Only a request that holds the count row sweeps, and it
-- removes a stale bucket only if it can take that bucket's source lock without waiting, so a
-- bucket is never swept from under its own request and no two requests wait on each other.
--
-- **Events.** `write_signin_event` (0024 body, replaced): each write sweeps up to 100 events
-- older than one year, the retention PLAN gives security logs (Data Protection: security logs,
-- one year), going through every event class so a class nobody writes any more is swept too. A
-- `throttle` refusal is written under a lock, once per source per minute and at most sixty a
-- minute over all sources: a refused flood cannot become a write flood. The P16 retention engine
-- takes over the sweep.
--
-- No index is added to an existing table: an index build would block writes on a table the
-- sign-in path writes to. The event queries are scoped to one class and use the existing
-- (class, created_at) index. Signatures, owners, search paths and EXECUTE grants of the two
-- replaced functions are unchanged (CREATE OR REPLACE keeps them); 0023 and 0024 are not edited.
-- The catalog's reviewed body digests move to the new text.

-- Writers wait from here to the commit; the lock is short (two triggers and one count).
LOCK TABLE auth_throttle_buckets IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE auth_throttle_admission (
  singleton    boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (singleton),
  live_buckets integer NOT NULL CHECK (live_buckets >= 0)
);

COMMENT ON TABLE auth_throttle_admission IS
  'The number of rows in auth_throttle_buckets other than the overflow buckets, kept by triggers on that table so a new source is admitted by one conditional update instead of a count of the table (P06.12.01). Global, one row, no identity.';

REVOKE ALL ON TABLE auth_throttle_admission
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

CREATE FUNCTION app.count_throttle_bucket_inserts() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_added integer;
BEGIN
  SELECT count(*) INTO v_added FROM added_buckets a
    WHERE a.key_digest <> '\x0000000000000000000000000000000000000000000000000000000000000000';
  IF v_added > 0 THEN
    UPDATE public.auth_throttle_admission SET live_buckets = live_buckets + v_added;
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.count_throttle_bucket_deletes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_removed integer;
BEGIN
  SELECT count(*) INTO v_removed FROM removed_buckets r
    WHERE r.key_digest <> '\x0000000000000000000000000000000000000000000000000000000000000000';
  IF v_removed > 0 THEN
    UPDATE public.auth_throttle_admission
      SET live_buckets = GREATEST(0, live_buckets - v_removed);
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.count_throttle_bucket_inserts() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.count_throttle_bucket_deletes() FROM PUBLIC;

CREATE TRIGGER auth_throttle_buckets_count_inserts
  AFTER INSERT ON auth_throttle_buckets
  REFERENCING NEW TABLE AS added_buckets
  FOR EACH STATEMENT EXECUTE FUNCTION app.count_throttle_bucket_inserts();
CREATE TRIGGER auth_throttle_buckets_count_deletes
  AFTER DELETE ON auth_throttle_buckets
  REFERENCING OLD TABLE AS removed_buckets
  FOR EACH STATEMENT EXECUTE FUNCTION app.count_throttle_bucket_deletes();
ALTER TABLE auth_throttle_buckets ENABLE ALWAYS TRIGGER auth_throttle_buckets_count_inserts;
ALTER TABLE auth_throttle_buckets ENABLE ALWAYS TRIGGER auth_throttle_buckets_count_deletes;

INSERT INTO auth_throttle_admission (singleton, live_buckets)
  SELECT true, count(*) FROM auth_throttle_buckets;

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
  v_known boolean;
  v_admitted boolean := false;
  v_may_sweep boolean := false;
  v_swept integer := 0;
  v_stale record;
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
  -- First lock, always: this source. Whoever holds it is the only request working on this
  -- source's bucket, and a sweep leaves the bucket alone while it is held.
  PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':' || encode(p_key_digest, 'hex')));
  SELECT true INTO v_known FROM public.auth_throttle_buckets b
    WHERE b.scope = p_scope AND b.key_digest = p_key_digest;
  IF v_known IS NULL THEN
    -- A new source. The update is the admission: it reserves a slot below the ceiling by locking
    -- the count row (the insert below raises the count through the table's trigger), or it
    -- matches nothing and locks nothing.
    UPDATE public.auth_throttle_admission
      SET live_buckets = live_buckets WHERE live_buckets < c_max_buckets;
    IF FOUND THEN
      v_admitted := true;
      v_may_sweep := true;
    ELSE
      -- Full. One request at a time may try to make room; the others do not wait for it.
      PERFORM 1 FROM public.auth_throttle_admission FOR UPDATE SKIP LOCKED;
      v_may_sweep := FOUND;
    END IF;
    IF v_may_sweep THEN
      -- Opportunistic sweep: rows untouched for over a day are dead weight (their bucket would
      -- refill full long before). Capped at 100 per call — bounded cost on the request path. A
      -- bucket goes only if its source lock is free right now, so never from under a request.
      FOR v_stale IN
        SELECT b.ctid AS row_id, b.scope, b.key_digest FROM public.auth_throttle_buckets b
        WHERE updated_at < v_now - INTERVAL '24 hours'
        LIMIT 100
      LOOP
        CONTINUE WHEN v_stale.key_digest = c_overflow;
        IF pg_try_advisory_xact_lock(
             hashtext(v_stale.scope || ':' || encode(v_stale.key_digest, 'hex'))) THEN
          DELETE FROM public.auth_throttle_buckets b
            WHERE b.ctid = v_stale.row_id AND b.scope = v_stale.scope
              AND b.key_digest = v_stale.key_digest;
          IF FOUND THEN
            v_swept := v_swept + 1;
          END IF;
        END IF;
      END LOOP;
      -- At the ceiling a freed slot is this source's: the count row is still held.
      IF v_swept > 0 THEN
        v_admitted := true;
      END IF;
    END IF;
    IF NOT v_admitted THEN
      v_key := c_overflow;
      PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':' || encode(v_key, 'hex')));
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
