-- 0015 — step-up MFA state on sessions (P06.06.04, ADR-0005, INV-17).
--
-- ## What step-up is
--
-- A fresh sign-in is MFA'd (ADR-0005), so it counts as stepped-up: `begin_session` stamps
-- `step_up_at` with the sign-in time. A step-up re-verification rotates with reason `step_up`
-- and moves the stamp to the rotation time; a privilege-change rotation inherits the
-- predecessor's stamp, because a role change is not a fresh human proof. Sensitive actions
-- (PLAN Security Architecture: user/role management, integration connect/disconnect, data
-- export, erasure, tenant termination, billing changes, support-access grants) require that
-- stamp to be within the last 15 minutes; the guard enforcing that lives in the application,
-- which reads the stamp out of `resolve_request_context`.
--
-- ## Expand-only, nullable, no backfill
--
-- `step_up_at` is nullable with no default, so the ADD rewrites nothing and the old release
-- keeps running (INV-17: only `ADD COLUMN ... NOT NULL` without `DEFAULT` trips the
-- migration check, and this is neither). Sessions predating this migration keep NULL and can
-- never pass a step-up check until they re-verify — fail closed by construction, which is also
-- why no backfill exists: stamping old sessions as stepped-up would be a lie.
--
-- `auth_transactions.step_up_session_id` binds a step-up OIDC round-trip to the session being
-- re-verified: the callback rotates exactly that session, and only when the provider subject
-- matches its user. Nullable with no default for the same expand-only reason; plain logins
-- leave it NULL. It is an opaque identifier, safe to store alongside the hashed state.

ALTER TABLE sessions ADD COLUMN step_up_at timestamptz;

COMMENT ON COLUMN sessions.step_up_at IS
  'Last MFA proof for this session: sign-in time, or the last step_up rotation time (a privilege_change rotation inherits it). NULL for sessions predating 0015 — never stepped-up until re-verified. Sensitive actions require it within 15 minutes.';

ALTER TABLE auth_transactions ADD COLUMN step_up_session_id uuid;

COMMENT ON COLUMN auth_transactions.step_up_session_id IS
  'NULL for a plain login; the session id being re-verified for a step-up round-trip. The callback rotates exactly this session when the subject matches.';

-- The old sign-in shapes are superseded: after this migration the new bodies are what run.
-- Deploy stays expand/contract (INV-17): a 6-argument `begin_sign_in` overload (bottom of this
-- file) keeps old hosts signing in through the rolling window — it delegates with a NULL
-- step-up binding, a plain login, which is all an old host can start. Narrow OUT-record
-- readers (`consume_sign_in`, `resolve_*`) need no shim: old callers selecting a column
-- subset by name ignore the added columns. Neither a defaulted parameter nor a same-arglist
-- shim would do for the rest: defaults live in the caller's expression (still binds the old
-- form), and PostgreSQL forbids two functions sharing IN-args with different OUT-records.
-- CREATE OR REPLACE is refused when the OUT-record type changes (42P13) — hence
-- drop-then-plain-CREATE below. The 6-arg overload is contracted (dropped) in 0016.
--
-- Deploy order is migrate-first, then roll the app: once 0015 lands, an old-code readiness
-- probe (which counts seven names without the overload) reports not-ready until its host
-- rolls — expected and safe (sign-in itself keeps working through the shim), not a defect.
-- A new-code probe against a pre-0015 database fails closed on the unknown 7-arg signature.
DROP FUNCTION IF EXISTS app.begin_sign_in(bytea, bytea, bytea, bytea, text, text);
DROP FUNCTION IF EXISTS app.consume_sign_in(bytea, bytea);
DROP FUNCTION IF EXISTS app.resolve_request_context(bytea);
DROP FUNCTION IF EXISTS app.resolve_session(bytea);
DROP FUNCTION IF EXISTS app.begin_session(text, bytea, uuid, bytea, text, bytea);

-- ---------------------------------------------------------------------------------------------
-- begin_session: stamp step-up only on fresh provider proof (Defect 1 fix).
-- ---------------------------------------------------------------------------------------------
--
-- A fresh sign-in is MFA'd only when the provider says the human proved presence recently:
-- `p_step_up` carries whether the ID token's `auth_time` was present and within the
-- 15-minute window (judged by the application against the token). Fresh proof stamps
-- `step_up_at` with the sign-in time; stale or absent proof leaves NULL, so the session
-- begins un-stepped-up and sensitive actions 403 until an explicit step-up round-trip.
-- No DEFAULT on the new parameter: PostgreSQL treats defaults as caller-side sugar, and
-- a defaulted 7th parameter would let a stale 6-argument call bind the new body with an
-- implicit NULL — silently recording the round-trip shape as a plain login. Old hosts keep
-- the old 6-argument name through the INVOKER shim below; new hosts pass all 7 arguments.
-- (Dropped above: without the DROP, OR REPLACE would keep a single 6-arg DEFINER and no
-- 7-arg form — the new parameter would silently vanish.)
CREATE FUNCTION app.begin_session(
  p_subject text,
  p_token_hash bytea,
  p_session_id uuid,
  p_provider_tokens_sealed bytea,
  p_key_id text,
  p_replaced_hash bytea,
  p_step_up boolean
) RETURNS TABLE (session_id uuid, user_id uuid, absolute_expires_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_user uuid;
  v_family uuid;
BEGIN
  -- Lock order is family first, then the presented session, then user, in this function,
  -- `rotate_session` and `resolve_session`: a re-login superseding a family while a rotation or a
  -- resolution of the same family is in flight takes all locks in the same order, so the callers
  -- serialise instead of deadlocking (AB-BA). The presented-session lock (taken below, before
  -- the user-row lock) means the supersede below runs only after that row's lock is held. The
  -- user-row FOR SHARE conflicts with a concurrent disable's UPDATE: either the disable commits
  -- first and v_user is NULL, or this insert commits first. Either way no live session exists
  -- for a disabled user — `resolve_session` re-checks `u.status = 'active'`, so a session minted
  -- ahead of a racing disable stops resolving rather than living on.
  IF p_replaced_hash IS NOT NULL THEN
    SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_replaced_hash;
    IF v_family IS NOT NULL THEN
      PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;
      PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_replaced_hash FOR UPDATE;
    END IF;
  END IF;

  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.cognito_sub = p_subject AND u.status = 'active'
  FOR SHARE;
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- The family lock above is held across the user-row lock: family first, then user, matching
  -- `rotate_session`. The supersede below re-uses the already-held family lock. It is scoped to
  -- the just-authenticated user: a presented token from another person's family matches nothing
  -- and revokes nothing, so a stolen-but-valid cookie can never become a weapon that signs the
  -- victim out of all their devices.
  IF v_family IS NOT NULL THEN
    v_now := clock_timestamp();
    UPDATE public.sessions s
    SET revoked_at = v_now, revocation_reason = 'superseded',
        provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
    WHERE s.family_id = v_family AND s.user_id = v_user AND s.revoked_at IS NULL;
  END IF;

  v_now := clock_timestamp();

  RETURN QUERY
  INSERT INTO public.sessions AS s
    (token_hash, id, family_id, user_id, rotation_reason, rotated_from, created_at, last_seen_at,
     idle_expires_at, absolute_expires_at, step_up_at, provider_tokens_sealed, provider_tokens_key_id)
  VALUES
    (p_token_hash, p_session_id, p_session_id, v_user, 'login', NULL, v_now, v_now,
     v_now + interval '12 hours', v_now + interval '7 days',
     CASE WHEN p_step_up IS TRUE THEN v_now ELSE NULL END,
     p_provider_tokens_sealed, p_key_id)
  RETURNING s.id, s.user_id, s.absolute_expires_at;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- rotate_session: step_up refreshes the stamp, privilege_change inherits it.
-- ---------------------------------------------------------------------------------------------
--
-- A step-up rotation follows a fresh human proof at the provider, so the successor's stamp is
-- the rotation time. A privilege-change rotation follows no such proof, so the successor keeps
-- the predecessor's stamp — including NULL, which stays un-stepped-up. The predecessor row is
-- untouched either way; the trigger allowlists only listed columns, and `step_up_at` on the
-- predecessor is never written after creation.
CREATE OR REPLACE FUNCTION app.rotate_session(
  p_token_hash bytea,
  p_new_token_hash bytea,
  p_new_session_id uuid,
  p_reason text
) RETURNS TABLE (session_id uuid, user_id uuid, absolute_expires_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_family uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('step_up', 'privilege_change') THEN
    RAISE EXCEPTION 'rotation reason must be step_up or privilege_change'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The family's lock first, as in `begin_session`: see there.
  SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_token_hash;
  IF v_family IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;

  -- Lock predecessor row before evaluating validity
  PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_token_hash FOR UPDATE;

  -- Lock the owning user row (FOR SHARE conflicts with a concurrent disable's UPDATE), so a
  -- disable racing this rotation serialises here rather than extending a session that should die.
  PERFORM 1
  FROM public.sessions s JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash FOR SHARE OF u;

  -- Fresh DB clock obtained after acquiring the locks
  v_now := clock_timestamp();

  RETURN QUERY
  WITH predecessor AS (
    SELECT s.token_hash, s.id, s.family_id, s.user_id, s.created_at, s.absolute_expires_at,
           s.step_up_at, s.provider_tokens_sealed, s.provider_tokens_key_id
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_now
      AND s.absolute_expires_at > v_now
      AND u.status = 'active'
  ), retired AS (
    UPDATE public.sessions s
    SET revoked_at = v_now, revocation_reason = 'rotated',
        provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
    FROM predecessor p
    WHERE s.token_hash = p.token_hash
    RETURNING s.id
  )
  INSERT INTO public.sessions AS n
    (token_hash, id, family_id, user_id, rotation_reason, rotated_from, created_at, last_seen_at,
     idle_expires_at, absolute_expires_at, step_up_at, provider_tokens_sealed, provider_tokens_key_id)
  SELECT p_new_token_hash, p_new_session_id, p.family_id, p.user_id, p_reason, p.id,
         GREATEST(v_now, p.created_at), GREATEST(v_now, p.created_at),
         LEAST(GREATEST(v_now, p.created_at) + interval '12 hours', p.absolute_expires_at),
         p.absolute_expires_at,
         CASE WHEN p_reason = 'step_up' THEN v_now ELSE p.step_up_at END,
         p.provider_tokens_sealed, p.provider_tokens_key_id
  FROM predecessor p
  JOIN retired r ON r.id = p.id
  RETURNING n.id, n.user_id, n.absolute_expires_at;
END
$$;

-- (Drops ran at the top of this migration — see above.)
CREATE FUNCTION app.begin_sign_in(
  p_state_hash bytea,
  p_binding_hash bytea,
  p_nonce_hash bytea,
  p_verifier_sealed bytea,
  p_key_id text,
  p_return_to text,
  p_step_up_session_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  DELETE FROM public.auth_transactions
  WHERE ctid IN (
    SELECT t.ctid FROM public.auth_transactions t
    WHERE t.expires_at <= v_now
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  );
  INSERT INTO public.auth_transactions
    (state_hash, binding_hash, nonce_hash, verifier_sealed, key_id, return_to,
     step_up_session_id, created_at, expires_at)
  VALUES
    (p_state_hash, p_binding_hash, p_nonce_hash, p_verifier_sealed, p_key_id, p_return_to,
     p_step_up_session_id, v_now, v_now + interval '10 minutes');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- consume_sign_in: return the step-up binding with the transaction (new OUT-record shape,
-- so plain CREATE after the drop above — OR REPLACE would hit 42P13 the other way round).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.consume_sign_in(
  p_state_hash bytea,
  p_binding_hash bytea
) RETURNS TABLE (nonce_hash bytea, verifier_sealed bytea, key_id text, return_to text,
                 step_up_session_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_claimed_binding bytea;
  v_claimed_nonce bytea;
  v_claimed_verifier bytea;
  v_claimed_key text;
  v_claimed_return text;
  v_claimed_step_up uuid;
  v_claimed_expires timestamptz;
  v_now timestamptz;
BEGIN
  -- The DELETE claims the transaction single-use: whichever caller wins the row lock deletes it
  -- and every other presentation finds nothing. The binding is compared before the clock is read:
  -- a foreign browser burns the transaction above and learns nothing about its expiry. The clock
  -- is read only after that claim's lock wait completes, so an expiry that lapses while this call
  -- blocks is already expired when the validation below runs. The claimed material is returned
  -- only when it is still usable — never its nonce, verifier, or return path otherwise.
  DELETE FROM public.auth_transactions t
  WHERE t.state_hash = p_state_hash
  RETURNING t.binding_hash, t.nonce_hash, t.verifier_sealed, t.key_id, t.return_to,
            t.step_up_session_id, t.expires_at
  INTO v_claimed_binding, v_claimed_nonce, v_claimed_verifier, v_claimed_key, v_claimed_return,
       v_claimed_step_up, v_claimed_expires;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_claimed_binding IS DISTINCT FROM p_binding_hash THEN
    RETURN;
  END IF;

  v_now := clock_timestamp();
  IF v_claimed_expires <= v_now THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_claimed_nonce, v_claimed_verifier, v_claimed_key, v_claimed_return,
                      v_claimed_step_up;
END
$$;

-- (Drops ran at the top of this migration — see above. Grants are re-asserted once, at the
-- end of this file after every CREATE, because DROP resets the ACL to defaults.)

-- ---------------------------------------------------------------------------------------------
-- resolve_session: expose the owner's provider subject for the step-up binding (P06.06.04).
--
-- The subject rides the existing user join — no new lock, no new clock read. The step-up
-- completion compares the fresh ID-token subject against exactly this value before rotating,
-- so a round-trip completed as another person rotates nothing.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.resolve_session(
  p_token_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, idle_expires_at timestamptz,
                 absolute_expires_at timestamptz, subject text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_family uuid;
BEGIN
  -- Canonical lock order is family, then target session, then owning user: every function takes
  -- locks in that order, so concurrent callers serialise instead of deadlocking (AB-BA). The
  -- family lookup is a key read without a lock; the locks below are taken in canonical order.
  -- The family-row lock pins the lineage while this call runs, the session-row lock means the
  -- clock below is read only after the lock protecting the authorized state is held: an idle or
  -- absolute expiry that lapses while this call waits on either lock is already expired when
  -- the recheck below runs, and a disable racing this call serialises on the user row rather
  -- than letting one stale resolution through.
  SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_token_hash;
  IF v_family IS NOT NULL THEN
    PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;
  END IF;

  PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_token_hash FOR UPDATE;

  PERFORM 1
  FROM public.sessions s JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash FOR SHARE OF u;

  -- Fresh DB clock obtained only after all locks above are held.
  v_now := clock_timestamp();

  RETURN QUERY
  UPDATE public.sessions s
  SET last_seen_at = GREATEST(s.last_seen_at, v_now),
      idle_expires_at = LEAST(v_now + interval '12 hours', s.absolute_expires_at)
  FROM public.users u
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > v_now
    AND s.absolute_expires_at > v_now
    AND u.id = s.user_id
    AND u.status = 'active'
    AND LEAST(v_now + interval '12 hours', s.absolute_expires_at) - s.idle_expires_at
        >= interval '60 seconds'
  RETURNING s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at, u.cognito_sub;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at, u.cognito_sub
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > v_now
    AND s.absolute_expires_at > v_now
    AND u.status = 'active';
END
$$;

-- ---------------------------------------------------------------------------------------------
-- resolve_request_context: expose the step-up stamp alongside the existing fields
-- (new OUT-record shape — plain CREATE, same 42P13 ordering as above).
-- ---------------------------------------------------------------------------------------------
--
-- The slide UPDATE is untouched; only the verdict SELECT gains columns. The freshness boolean
-- is judged here against the database clock (`v_now`, sampled after all locks): the 15-minute
-- window in PLAN Security Architecture is an authorization decision, and authorization time
-- comes from PostgreSQL, never from a caller clock. The guard branches on the boolean; the
-- raw stamp rides along for observability only.
CREATE FUNCTION app.resolve_request_context(
  p_token_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, organisation_id uuid, role text,
                 permissions text[], idle_expires_at timestamptz,
                 absolute_expires_at timestamptz, step_up_at timestamptz,
                 step_up_fresh boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_family uuid;
BEGIN
  SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_token_hash;
  IF v_family IS NOT NULL THEN
    PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;
  END IF;

  PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_token_hash FOR UPDATE;

  PERFORM 1
  FROM public.sessions s JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash FOR SHARE OF u;

  -- All remaining work happens inside one subtransaction: the marker is set first (the
  -- membership lock needs the exemption to see rows at all — without it the lock would match
  -- nothing and order nothing), then the membership lock, then the clock, then the slide and
  -- the verdict sharing that single v_now. The block resets the marker before re-raising, so
  -- no error path can leak it into the caller's transaction where a later read as the
  -- function owner would inherit the exception.
  BEGIN
    PERFORM set_config('app.request_lookup', 'resolve_request_context', true);

    -- The membership lock: held before v_now is sampled, or a wait on it (concurrent disable
    -- holding the row, or a table-level lock) would evaluate expiry against stale time.
    -- FOR SHARE conflicts with a concurrent disable's UPDATE on the same rows, so the disable
    -- commits either before this read (row refused now) or after (next request refuses).
    PERFORM 1
    FROM public.sessions s JOIN public.users u ON u.id = s.user_id
    JOIN public.memberships m ON m.user_id = s.user_id
    WHERE s.token_hash = p_token_hash FOR SHARE OF m;

    -- Fresh DB clock obtained only after all locks above are held.
    v_now := clock_timestamp();

    -- The capped activity slide, folded in so validity and write share one v_now: a session that
    -- lapses between a separate read and write could be admitted-then-slid; here the write IS the
    -- verdict. Skipped under a minute like resolve_session — never later than ideal.
    UPDATE public.sessions s
    SET last_seen_at = GREATEST(s.last_seen_at, v_now),
        idle_expires_at = LEAST(v_now + interval '12 hours', s.absolute_expires_at)
    FROM public.users u
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_now
      AND s.absolute_expires_at > v_now
      AND u.id = s.user_id
      AND u.status = 'active'
      AND LEAST(v_now + interval '12 hours', s.absolute_expires_at) - s.idle_expires_at
          >= interval '60 seconds';

    RETURN QUERY
    SELECT s.id, s.user_id, m.organisation_id, m.role, m.permissions,
           s.idle_expires_at, s.absolute_expires_at, s.step_up_at,
           (s.step_up_at IS NOT NULL AND s.step_up_at > v_now - interval '15 minutes')
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    JOIN public.memberships m ON m.user_id = s.user_id
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_now
      AND s.absolute_expires_at > v_now
      AND u.status = 'active'
      AND m.status = 'active';

    PERFORM set_config('app.request_lookup', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.request_lookup', '', true);
    RAISE;
  END;
  RETURN;
END
$$;

-- The DROPs above reset the ACLs to defaults, so re-assert the catalog contract (same
-- owners, search_path, moin_identity-only grants — the catalog names these exact signatures):
REVOKE ALL ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, uuid) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea, boolean) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.consume_sign_in(bytea, bytea) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.resolve_request_context(bytea) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.resolve_session(bytea) FROM PUBLIC, moin_app;

GRANT EXECUTE ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, uuid) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea, boolean) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.consume_sign_in(bytea, bytea) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.resolve_request_context(bytea) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.resolve_session(bytea) TO moin_identity;

-- ---------------------------------------------------------------------------------------------
-- Rolling-window overload (H1): old hosts call 6-argument `begin_sign_in`.
-- ---------------------------------------------------------------------------------------------
--
-- A different IN-arity is a different function slot, so this coexists with the 7-arg form
-- above (unlike the OUT-record changes, which cannot shim). It delegates with a NULL
-- step-up binding: a plain login, which is all an old host can start — it knows no step-up,
-- and `startStepUp` passes 7 arguments, so no round-trip can begin here. Contracted (dropped)
-- in 0016 once no old host remains.
--
-- SECURITY INVOKER, not DEFINER (Defect 3): the old-host readiness probe counts executable
-- DEFINERs (`total = 7`), so an eighth DEFINER would 503 every not-yet-rolled host the moment
-- 0015 lands. As INVOKER this runs as the caller — `moin_identity`, which already holds
-- EXECUTE on the 7-arg DEFINER — and `pg_proc` keeps exactly 7 definers. The catalog still
-- pins the shim body and its moin_identity-only grant; the body check is arity-keyed.
CREATE FUNCTION app.begin_sign_in(
  p_state_hash bytea,
  p_binding_hash bytea,
  p_nonce_hash bytea,
  p_verifier_sealed bytea,
  p_key_id text,
  p_return_to text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  PERFORM app.begin_sign_in(p_state_hash, p_binding_hash, p_nonce_hash, p_verifier_sealed,
                            p_key_id, p_return_to, NULL::uuid);
END
$$;

REVOKE ALL ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) FROM PUBLIC, moin_app;

GRANT EXECUTE ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) TO moin_identity;

