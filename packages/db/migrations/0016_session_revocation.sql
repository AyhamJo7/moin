-- 0016 — session revocation (P06.06.05, ADR-0005, INV-02, FS-16, QG-09).
-- migration-check: allow add-check-validated because the constraint is added NOT VALID (the check's 120-character lookahead cannot see past the reason list), and every existing row already satisfies the narrower list it replaces, so validation would only scan the auth table under a lock to learn that.
--
-- ## What this adds
--
-- PLAN (Security Architecture): sessions are revoked on password reset, MFA reset, role change and
-- membership removal, and on demand ("sign out other devices"). Until now the per-request re-check
-- (0014) refused a removed or disabled member but left their sessions alive, holding sealed
-- provider tokens, and a re-enabled member's old sessions came back to life. Revocation ends them.
--
--   * `app.revoke_user_sessions(user, keep, reason)` — the one implementation. Not executable by any
--     runtime role: only the three callers below reach it, as the function owner.
--   * `app.revoke_session(bytea, text)` — "sign out other devices": revokes every other live session
--     of the presented session's owner. The owner is read from the presented session, never taken
--     from the caller, and a presented session that is not valid now revokes nothing.
--   * `app.revoke_session(uuid, text)` — revoke every session of a user for `password_reset` or
--     `mfa_reset`. The callers are the provider-event and support flows of P06.09; this is the
--     primitive they will need, tested here.
--   * `memberships_revoke_sessions` — a trigger, so that no writer of `memberships` (P06.07 role
--     management, P06.08 removal, tenant termination's ON DELETE CASCADE, an operator's psql)
--     can change who someone is without ending the sessions that were issued for the old answer.
--
-- The two `revoke_session` overloads share the existing function's name on purpose: the readiness
-- probe every host runs counts distinct SECURITY DEFINER names executable by `moin_identity`
-- (exactly seven). A new name would turn every not-yet-rolled host unready the moment this
-- migration ran. Overloads keep that set unchanged (rolling deploy: migrate first, then roll).
--
-- ## Lock order
--
-- A trigger runs after the membership row is locked, then needs session rows. The per-request
-- lookup (0015) locked session rows first and the membership last, so a role change racing a
-- request was an AB-BA cycle: the request held the session and waited for the membership; the
-- writer held the membership and waited for the session. PostgreSQL would abort one of them after a
-- second. The order is therefore now
--
--     membership → session family root → session → user
--
-- everywhere a membership is involved. The only function that locked a membership after a session
-- was `resolve_request_context`; it is redefined below to take it first. `begin_session`,
-- `rotate_session` and `resolve_session` never lock a membership and keep family → session → user.
-- The revoking helper locks every family root of the user in ascending id, then every live session
-- in ascending id, so two revokers (two memberships of one person changed in two transactions) take
-- the same locks in the same order.
--
-- ## Not in this migration
--
-- A user's own `status` is not watched: no runtime role can write `users`, and its writers
-- (invitation acceptance, P06.08) are not built. Whoever builds account disablement must call
-- `app.revoke_user_sessions` there too, or a re-enabled account revives its old sessions. The
-- rolling-window shims of 0015 are contracted in a later migration, not this one: 0015's own
-- comments (immutable once applied) say "0016", which this migration took for revocation.

-- ---------------------------------------------------------------------------------------------
-- 1. The reasons a session can end.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_revocation_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_revocation_reason_check
  CHECK (revocation_reason IN ('rotated', 'superseded', 'signed_out', 'sign_out_others',
                               'role_change', 'membership_removed', 'membership_status',
                               'password_reset', 'mfa_reset')) NOT VALID;

-- ---------------------------------------------------------------------------------------------
-- 2. The helper: revoke a user's live sessions, optionally sparing one.
-- ---------------------------------------------------------------------------------------------
--
-- Returns the number revoked, or NULL when `p_keep_token_hash` is given and that session is not
-- valid now (revoked, expired, wrong user, inactive user) — in which case nothing is revoked, so a
-- dead cookie cannot be used to sign a live person out. Provider tokens are wiped with the
-- revocation, as in every other path (a refresh token has no business outliving its session).
CREATE FUNCTION app.revoke_user_sessions(
  p_user_id uuid,
  p_keep_token_hash bytea,
  p_reason text
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_count integer;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('sign_out_others', 'role_change', 'membership_removed',
                                          'membership_status', 'password_reset', 'mfa_reset') THEN
    RAISE EXCEPTION 'unknown revocation reason' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Families (ascending), then sessions (ascending), then the user row (FOR UPDATE): exactly
  -- the family -> session -> user order of `rotate_session` and `begin_session`, so no AB-BA
  -- with either. FOR UPDATE (not SHARE) conflicts with the SHARE user-row lock both functions
  -- hold across their writes: a sign-in racing a revocation serialises here. READ COMMITTED
  -- takes a fresh snapshot per command, so the UPDATE below sees a session minted before this
  -- transaction waited, and a sign-in that waits on this revocation inserts after it commits —
  -- either way no live session survives a committed revocation (HIGH review finding).
  PERFORM 1 FROM public.sessions f
  WHERE f.id IN (SELECT s.family_id FROM public.sessions s
                 WHERE s.user_id = p_user_id AND s.revoked_at IS NULL)
  ORDER BY f.id FOR UPDATE;

  PERFORM 1 FROM public.sessions s
  WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
  ORDER BY s.id FOR UPDATE;

  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;

  -- The clock is read only after every lock is held, so a wait cannot leave it stale.
  v_now := clock_timestamp();

  IF p_keep_token_hash IS NOT NULL THEN
    PERFORM 1
    FROM public.sessions s JOIN public.users u ON u.id = s.user_id
    WHERE s.token_hash = p_keep_token_hash
      AND s.user_id = p_user_id
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_now
      AND s.absolute_expires_at > v_now
      AND u.status = 'active';
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE public.sessions s
  SET revoked_at = v_now, revocation_reason = p_reason,
      provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
  WHERE s.user_id = p_user_id
    AND s.revoked_at IS NULL
    AND (p_keep_token_hash IS NULL OR s.token_hash <> p_keep_token_hash);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. "Sign out other devices".
-- ---------------------------------------------------------------------------------------------
-- 'others' lives on the 2-arg core: callers pass 'others', old hosts call the 1-arg
-- INVOKER shim below and get single sign-out. The shim keeps the frozen `revoke_session(bytea)`
-- name alive for old-host probes and calls; the core is the only revoke DEFINER besides the
-- reset overload, so the readiness distinct-name seven do not move. DROP-then-CREATE (not OR
-- REPLACE): the 0012 1-arg DEFINER and this 2-arg form are different signatures, and CREATE
-- alone would leave both behind. Strict arities (no defaults): a defaulted 2nd argument would
-- make every 1-arg call ambiguous between the shim and the core (42725).
DROP FUNCTION IF EXISTS app.revoke_session(bytea);
CREATE FUNCTION app.revoke_session(
  p_token_hash bytea,
  p_scope text
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('self', 'others') THEN
    RAISE EXCEPTION 'revocation scope must be self or others' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_scope = 'self' THEN
    UPDATE public.sessions s
    SET revoked_at = clock_timestamp(), revocation_reason = 'signed_out',
        provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
    WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL;
    RETURN CASE WHEN FOUND THEN 1 ELSE 0 END;
  END IF;
  -- user_id never changes after creation (the session trigger forbids it), so this unlocked read
  -- can only name the right owner; validity is judged under the helper's locks.
  SELECT s.user_id INTO v_user FROM public.sessions s WHERE s.token_hash = p_token_hash;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN app.revoke_user_sessions(v_user, p_token_hash, 'sign_out_others');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Reset: every session of a user.
-- ---------------------------------------------------------------------------------------------
-- Reset (password/MFA) cannot ride the bytea signature: a uuid and a digest are different
-- types, so this overload coexists without changing any existing signature. Same owner, path
-- and moin_identity-only grant as every other session function; the catalog pins it by
-- signature. Old hosts never call it (P06.09 flows are new), so no shim is needed.
CREATE FUNCTION app.revoke_session(
  p_user_id uuid,
  p_reason text
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('password_reset', 'mfa_reset') THEN
    RAISE EXCEPTION 'reason must be password_reset or mfa_reset' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN app.revoke_user_sessions(p_user_id, NULL, p_reason);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. The membership trigger.
-- ---------------------------------------------------------------------------------------------
--
-- Unconditional AFTER UPDATE OR DELETE: what counts as a change is decided here, in a body the
-- catalog check pins by digest, because a trigger's WHEN clause is not covered by that pin.
--   * DELETE (including organisation termination's ON DELETE CASCADE) → membership_removed.
--   * role or permissions → role_change.
--   * status → membership_status: a disabled or suspended member must not come back to life with
--     their old sessions when re-enabled.
--   * user_id re-pointed → both people lose their sessions.
-- Unrelated updates (version, updated_at) revoke nothing. A new membership revokes nothing: a
-- person invited while signed in keeps their session, and the per-request check starts admitting
-- them.
CREATE FUNCTION app.revoke_sessions_on_membership_change() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app.revoke_user_sessions(OLD.user_id, NULL, 'membership_removed');
    RETURN OLD;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    -- Least id first: two opposite-direction swaps (A->B racing B->A) take the same locks in
    -- the same order instead of deadlocking.
    IF OLD.user_id < NEW.user_id THEN
      PERFORM app.revoke_user_sessions(OLD.user_id, NULL, 'membership_removed');
      PERFORM app.revoke_user_sessions(NEW.user_id, NULL, 'role_change');
    ELSE
      PERFORM app.revoke_user_sessions(NEW.user_id, NULL, 'role_change');
      PERFORM app.revoke_user_sessions(OLD.user_id, NULL, 'membership_removed');
    END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role OR NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    PERFORM app.revoke_user_sessions(NEW.user_id, NULL, 'role_change');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM app.revoke_user_sessions(NEW.user_id, NULL, 'membership_status');
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER memberships_revoke_sessions
  AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.revoke_sessions_on_membership_change();
-- Fires in replica mode too, so a session setting cannot switch it off.
ALTER TABLE memberships ENABLE ALWAYS TRIGGER memberships_revoke_sessions;

-- ---------------------------------------------------------------------------------------------
-- 6. The per-request lookup, membership first.
-- ---------------------------------------------------------------------------------------------
--
-- Identical to 0015 in what it returns and decides; only the lock order moved (see the header).
-- Same signature and OUT record, so CREATE OR REPLACE keeps owner and ACL. The session's family and
-- user are read without a lock: both are fixed at creation, so the read can only name the right
-- rows; validity is judged below, under the locks, against the clock sampled after them.
CREATE OR REPLACE FUNCTION app.resolve_request_context(
  p_token_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, organisation_id uuid, role text,
                 permissions text[], idle_expires_at timestamptz,
                 absolute_expires_at timestamptz, step_up_at timestamptz,
                 step_up_fresh boolean, step_up_remaining_seconds double precision,
                 idle_remaining_seconds double precision, absolute_remaining_seconds double precision)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_family uuid;
BEGIN
  SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_token_hash;

  -- All remaining work happens inside one subtransaction: the marker is set first (the
  -- membership lock needs the exemption to see rows at all — without it the lock would match
  -- nothing and order nothing), then the locks, then the clock, then the slide and the verdict
  -- sharing that single v_now. The block resets the marker before re-raising, so no error path can
  -- leak it into the caller's transaction where a later read as the function owner would inherit
  -- the exception.
  BEGIN
    PERFORM set_config('app.request_lookup', 'resolve_request_context', true);

    -- The membership lock comes first, before any session row (see the header): a role change or
    -- removal holds the membership and then revokes sessions, so a request holding a session while
    -- it waited here would be one half of a deadlock. FOR SHARE conflicts with that writer's
    -- UPDATE or DELETE: it commits either before this read (refused or revoked now) or after.
    PERFORM 1
    FROM public.sessions s JOIN public.users u ON u.id = s.user_id
    JOIN public.memberships m ON m.user_id = s.user_id
    WHERE s.token_hash = p_token_hash FOR SHARE OF m;

    IF v_family IS NOT NULL THEN
      PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;
    END IF;

    PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_token_hash FOR UPDATE;

    PERFORM 1
    FROM public.sessions s JOIN public.users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash FOR SHARE OF u;

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
           (s.step_up_at IS NOT NULL AND isfinite(s.step_up_at) AND s.step_up_at > v_now - interval '15 minutes' AND s.step_up_at <= v_now + interval '30 seconds'),
           -- Remaining validity in seconds, judged entirely on the database clock: the app
           -- spends this budget in local elapsed time, so constant app↔DB skew can neither
           -- stretch nor shrink the verdict (Defect 2). NULL stamp means no budget column
           -- matters — the row is refused by the boolean and never cached by the app.
           CASE
             WHEN s.step_up_at IS NOT NULL AND isfinite(s.step_up_at) AND s.step_up_at > v_now - interval '15 minutes' AND s.step_up_at <= v_now + interval '30 seconds'
             THEN extract(epoch from (s.step_up_at + interval '15 minutes' - v_now))::double precision
             ELSE NULL
           END,
           -- Remaining idle and absolute session lifetimes in seconds on the DB clock:
           -- caching bounds its maximum authority lifetime by these durations in monotonic
           -- time so app↔DB clock offset cannot extend authority past session expiry.
           extract(epoch from (s.idle_expires_at - v_now))::double precision,
           extract(epoch from (s.absolute_expires_at - v_now))::double precision
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

-- ---------------------------------------------------------------------------------------------
-- Shim for old hosts (rolling window, contracted with the 0015 shims): INVOKER, so it runs
-- as moin_identity and does not inflate the DEFINER seven. Delegates with the 'self' scope.
CREATE FUNCTION app.revoke_session(
  p_token_hash bytea
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  RETURN app.revoke_session(p_token_hash, 'self');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Execution. The core and the reset overload: moin_identity only, by exact signature. The shim:
-- moin_identity only as well (it runs as its caller, which is moin_identity). The helper and the
-- trigger function: nobody — they run only as the owner, called from the functions above.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.revoke_session(bytea, text) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.revoke_session(uuid, text) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.revoke_session(bytea) FROM PUBLIC, moin_app;
GRANT EXECUTE ON FUNCTION app.revoke_session(bytea, text) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.revoke_session(uuid, text) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.revoke_session(bytea) TO moin_identity;

REVOKE ALL ON FUNCTION app.revoke_user_sessions(uuid, bytea, text) FROM PUBLIC, moin_app, moin_identity;
REVOKE ALL ON FUNCTION app.revoke_sessions_on_membership_change() FROM PUBLIC, moin_app, moin_identity;
