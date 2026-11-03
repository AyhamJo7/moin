-- 0082 — bound the authentication throttle and security event tables (P06.12.01, P06.12.02;
-- security acceptance G11 M3).
-- migration-check: allow create-index-blocking because no deployed environment exists yet and auth_security_events holds only coarse authentication outcomes on a development database; the indexes are small and the table is not on any request path that waits for them.
--
-- ## What was wrong
--
-- `auth_throttle_buckets` was bounded only by a day of distinct sources: a rotating scanner (each
-- IPv6 address its own source, before the /64 fix) made the table as large as it wanted for a
-- day. `auth_security_events` had no retention at all, and every refused callback wrote a row
-- without authentication.
--
-- ## The change
--
-- `take_signin_bucket` (0023 body, replaced): a source without a row gets one only while the table
-- holds fewer than 50 000 buckets; past that it shares one overflow bucket per scope (the
-- all-zero digest). The table cannot exceed the ceiling plus the overflow rows, and rotating
-- sources cannot buy fresh budgets. A source that already has a row pays nothing extra.
--
-- `write_signin_event` (0024 body, replaced): each write sweeps up to 100 events older than one
-- year, the retention PLAN gives security logs (Data Protection: security logs, one year), and a
-- `throttle` refusal is stored once per source per minute. A refused flood cannot become a write
-- flood. The P16 retention engine takes over the sweep.
--
-- Two indexes serve the sweep and the once-per-minute check. Signatures, owners, search paths and
-- EXECUTE grants are unchanged (CREATE OR REPLACE keeps them); 0023 and 0024 are not edited. The
-- catalog's reviewed body digests move to the new text.

CREATE INDEX auth_security_events_created_idx ON auth_security_events (created_at);
CREATE INDEX auth_security_events_throttle_idx ON auth_security_events (source_digest, created_at DESC)
  WHERE class = 'throttle';

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
  v_rows integer;
  -- G11 M3: the table never holds more than this many distinct sources. A new source that would
  -- exceed it shares the scope's overflow bucket (the all-zero digest) instead of getting a row,
  -- so a rotating scanner cannot grow the table, and cannot buy itself fresh budgets either.
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
  -- Which row does this source use? Its own if it has one; a new source gets one only while the
  -- table is under the ceiling. The existence probe and the count are bounded index scans
  -- (the count stops at the ceiling), and a source that already has a row pays neither.
  SELECT true INTO v_known FROM public.auth_throttle_buckets b
    WHERE b.scope = p_scope AND b.key_digest = p_key_digest;
  IF v_known IS NULL THEN
    SELECT count(*) INTO v_rows FROM (
      SELECT 1 FROM public.auth_throttle_buckets LIMIT c_max_buckets
    ) capped;
    IF v_rows >= c_max_buckets THEN
      v_key := c_overflow;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':' || encode(v_key, 'hex')));
  -- Opportunistic sweep: rows untouched for over a day are dead weight (their bucket would
  -- refill full long before). Capped at 100 per call — bounded cost on the request path.
  DELETE FROM public.auth_throttle_buckets
    WHERE ctid IN (
      SELECT ctid FROM public.auth_throttle_buckets
        WHERE updated_at < v_now - INTERVAL '24 hours'
        LIMIT 100
    );
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
  -- table sweeps itself: up to 100 rows older than that go on every write, so deletion keeps
  -- pace with insertion without a scheduler (the retention engine of P16 takes this over).
  DELETE FROM public.auth_security_events
    WHERE ctid IN (
      SELECT ctid FROM public.auth_security_events
        WHERE created_at < v_now - INTERVAL '1 year'
        LIMIT 100
    );
  -- A throttle refusal is recorded once per source per minute: refusals are exactly the rows an
  -- attacker can make without limit, and the count of refusals is in the buckets, not here.
  IF p_class = 'throttle' AND EXISTS (
    SELECT 1 FROM public.auth_security_events e
      WHERE e.class = 'throttle' AND e.source_digest = p_source_digest
        AND e.created_at > v_now - INTERVAL '1 minute'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.auth_security_events
    (id, outcome, class, reason_class, source_digest, is_new_family, created_at)
    VALUES (gen_random_uuid(), p_outcome, p_class, p_reason_class, p_source_digest,
            COALESCE(p_is_new_family, false), v_now);
END
$$;
