-- 0084 — two corrections to the sign-in throttle of 0083 (P06.12.01; ROADMAP X3, review of #267).
--
-- `take_signin_bucket` read the clock once, on entry, before it waited for any lock. A request
-- that then waited while another took the same bucket (the shared overflow bucket at saturation,
-- or its own source's bucket) refilled against a time older than the other's update: the interval
-- went negative, tokens were subtracted, and the balance could fall below zero and fail the
-- table's check, answering an error instead of 429. The clock is now read again once the bucket's
-- lock is held, and a refill interval is never negative.
--
-- The sweep selected stale rows without locking them. A call of the 0023 body still in flight
-- while 0083 committed could have deleted such a row and be waiting for the count row, which this
-- request held while waiting for the same stale row: a deadlock. Sweep candidates are now taken
-- `FOR UPDATE SKIP LOCKED`, so a row another transaction holds is passed over.
--
-- Only the function body changes: signature, owner, search path and EXECUTE grant are kept
-- (CREATE OR REPLACE), 0083 is not edited, and the catalog's reviewed body digest moves.

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
        -- A row another transaction holds (an in-flight call of an earlier body deleting it) is
        -- passed over, never waited for: waiting here while holding the count row deadlocks.
        FOR UPDATE SKIP LOCKED
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
  -- The clock is read again now that this request holds the lock of the bucket it will use: the
  -- reading taken on entry is older than any change a request that held the lock before it
  -- committed, and refilling against it would subtract tokens. The interval never goes negative.
  v_now := clock_timestamp();
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
                         GREATEST(0, EXTRACT(EPOCH FROM (v_now - b.updated_at)))),
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
