-- 0023 — authentication throttle buckets (P06.12.01, INV-01).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Why a table, not Valkey (founder-approved shape)
--
-- Throttles need state shared across instances. Valkey runs locally but no server client,
-- secret or failure mode exists for it; a Postgres bucket table migrates with the schema,
-- enforces its own bounds by CHECK, and needs no new infrastructure. Token buckets, one row
-- per (scope, key): fixed-window counters would let a burst straddle two windows at twice
-- the rate; buckets refill continuously, so the ceiling holds at every instant.
--
-- ## Global by necessity, minimal by construction
--
-- Pre-auth throttles fire before any tenant is known (login/callback have no session), so
-- this table carries NO organisation_id and is on the global register with that reason. What
-- it stores is deliberately unlinkable: a keyed HMAC-SHA256 digest of (IP or account id),
-- never the IP or id itself (INV-12) — a reader of this table learns counts and timestamps,
-- never who or where. Rows live at most a day past their last touch: every take opportunistically
-- sweeps stale rows (updated_at older than 24 h), capped at 100 per call so one busy request never
-- pays for the whole table; a rotating scanner's one-shot rows therefore cap the table at roughly
-- a day of distinct sources, not forever. No scheduler, no new infrastructure.
--
-- ## Scopes and ceilings
--
-- Two scopes, separate buckets: `ip` (per source address, all auth endpoints) and `account`
-- (per verified subject, post-auth endpoints: step-up, sign-out-others, recovery, members,
-- support). Per-endpoint breakdown would let an attacker rotate endpoints; per-scope buckets
-- make every auth-adjacent call cost from the same budget. Ceilings live in the consuming
-- guard (application change, same branch), not here: this migration is storage + the atomic
-- take primitive. `take_signin_bucket` takes N tokens or refuses with the retry delay — one
-- round trip, no read-then-write race.
--
-- No RLS (global by design, registered), no runtime table access at all (buckets advance
-- only through the DEFINER, which also sweeps stale rows), tight grants below.

CREATE TABLE auth_throttle_buckets (
  scope       text        NOT NULL CHECK (scope IN ('ip', 'account')),
  key_digest  bytea       NOT NULL CHECK (octet_length(key_digest) = 32),
  tokens      double precision NOT NULL CHECK (tokens >= 0 AND tokens <= 100000),
  capacity    double precision NOT NULL CHECK (capacity > 0 AND capacity <= 100000),
  refill_per_second double precision NOT NULL CHECK (refill_per_second >= 0),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, key_digest)
);

COMMENT ON TABLE auth_throttle_buckets IS
  'Token buckets for authentication throttling (P06.12.01). Global: keyed by HMAC digest of IP/account, never the value (INV-12). Advanced only through take_signin_bucket; stale rows swept by the same function.';

-- Index for the opportunistic stale-row sweep (updated_at older than 24 h). Same-migration
-- table, new and empty — see the migration-check allow line above.
CREATE INDEX auth_throttle_buckets_sweep_idx ON auth_throttle_buckets (updated_at);

REVOKE ALL ON TABLE auth_throttle_buckets
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- take_signin_bucket: refill-then-take, atomically.
-- ---------------------------------------------------------------------------------------------
--
-- Upserts the bucket (first call sets capacity + full tokens), refills by wall clock
-- (clock_timestamp, never caller time), takes `p_cost` tokens when available. Returns
-- (allowed, retry_after_ms): allowed rows consume; refused rows leave the bucket untouched
-- (a refused call must not drain what a later allowed one needs). Advisory lock per bucket
-- serialises concurrent takes holding nothing else — same shape as the per-invitation lock
-- in 0018. Capacity/refill changes take effect on next call (no separate config path).
-- Before taking, the function opportunistically deletes up to 100 rows untouched for over
-- 24 h (capped so one request never pays for the whole table): rotating-source rows bound
-- the table to roughly a day of distinct keys. A full bucket is itself untouched for a day
-- only when idle that long — deleting it then costs nothing, since the take below recreates
-- it full on next use.

CREATE FUNCTION app.take_signin_bucket(
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
    VALUES (p_scope, p_key_digest, p_capacity, p_capacity, p_refill_per_second, v_now)
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
      WHERE scope = p_scope AND key_digest = p_key_digest;
    RETURN QUERY SELECT true, 0;
  ELSE
    RETURN QUERY SELECT false,
      GREATEST(0, CEIL(((p_cost - v_tokens) / NULLIF(p_refill_per_second, 0)) * 1000))::integer;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.take_signin_bucket(text, bytea, double precision, double precision, double precision)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.take_signin_bucket(text, bytea, double precision, double precision, double precision) TO moin_app;
