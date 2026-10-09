-- 0027 — revocation lock order: families → sessions → users last (P06.06.05 H1).
-- migration-check: allow create-index-blocking because this migration creates no indexes.
--
-- ## What was wrong
--
-- `app.revoke_user_sessions` (0016) and `app.set_user_status` (0019) took the user row
-- FOR UPDATE first, then families, then sessions. Every reader
-- (`begin_session`/`rotate_session`/`resolve_session`/`resolve_request_context`, 0015/0016)
-- takes family → session → users FOR SHARE with no advisory lock. Revoker holds users and
-- waits on sessions while a reader holds sessions and waits on users: AB-BA, sqlstate
-- 40P01, reproduced on a scratch DB (QG-09 §2 FIX-1). The 0016/0019 header comments
-- claiming single-wait deadlock-freedom are wrong in place (applied files are immutable);
-- this header states the corrected order, which is what every path below implements.
--
-- ## Canonical order (every path, no exceptions)
--
-- advisory (per-user, re-entrant) → families ascending → sessions ascending → users last
-- (FOR SHARE, or no separate users lock where the fresh-snapshot final UPDATE covers it).
-- Readers already traverse family → session → users; revokers now traverse the same
-- direction, so no two paths hold-and-wait in opposite order.
--
-- ## What changes, function by function
--
-- `revoke_user_sessions`: the separate `users FOR UPDATE` is gone. The keep-token
-- validity check reads user status through the already-locked session join (no separate
-- users lock); the final UPDATE's fresh snapshot (READ COMMITTED, per-command) sees
-- sessions minted while waiting, so no live session survives a committed revocation.
-- `set_user_status`: prelocks families then sessions BEFORE the `UPDATE users SET
-- status`, then flips status, then calls the helper (locks already held, re-entrant
-- advisory). The audit `append_audit_event` call and correlation forwarding are
-- verbatim. `revoke_member_sessions` needs no body change (it delegates to the helper)
-- but is re-created only if its comments state the old order — they do not; left alone.
--
-- No signature, owner, grant or search_path change: the catalog pins identity, not body,
-- except REVIEWED_BODIES digests, which move to the new texts (see the catalog change in
-- this PR). Signatures: `revoke_user_sessions(uuid, bytea, text)`,
-- `set_user_status(uuid, text, text, uuid, uuid)`.

-- ---------------------------------------------------------------------------------------------
-- 1. revoke_user_sessions: families → sessions → validity-via-locked-rows → final UPDATE.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.revoke_user_sessions(
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

  -- Serialisation first: the per-user advisory lock, before any row lock. The trigger and
  -- the two entry points all funnel through here, so every revocation takes it. Re-entrant
  -- in-session: callers holding it (set_user_status) re-take without waiting.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Families (ascending), then sessions (ascending): the same direction every reader
  -- traverses (family → session → users). No users lock here at all — the validity check
  -- below reads user status through the session join on already-locked rows, and the final
  -- UPDATE's fresh snapshot sees whatever committed while waiting.
  PERFORM 1 FROM public.sessions f
  WHERE f.id IN (SELECT s.family_id FROM public.sessions s
                 WHERE s.user_id = p_user_id AND s.revoked_at IS NULL)
  ORDER BY f.id FOR UPDATE;

  PERFORM 1 FROM public.sessions s
  WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
  ORDER BY s.id FOR UPDATE;

  -- The clock is read only after every lock is held, so a wait cannot leave it stale.
  v_now := clock_timestamp();

  IF p_keep_token_hash IS NOT NULL THEN
    -- Validity through the locked rows: the session join pins the user row's status
    -- without a separate users lock (the join's user side needs no lock — status is
    -- re-checked by the final UPDATE's snapshot anyway; a concurrent disable commits
    -- first and the UPDATE below still revokes, which is the safe direction).
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
-- 2. set_user_status: prelock families → sessions BEFORE the status flip, then delegate.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_user_status(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
) RETURNS TABLE (changed boolean, revoked integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_count integer;
  v_revoked integer;
BEGIN
  IF p_user_id IS NULL OR p_status IS NULL OR p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'user id and active/disabled status are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('password_reset', 'mfa_reset') THEN
    RAISE EXCEPTION 'reason must be password_reset or mfa_reset'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Advisory lock FIRST, before any row lock — the same serialisation point every revocation
  -- takes. The helper re-takes it (re-entrant), so the order here and inside is identical.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  -- Prelock families then sessions BEFORE touching the user row: canonical order
  -- (advisory → families → sessions → users last). A concurrent reader traverses the same
  -- direction, so no AB-BA cycle exists. Locks held here are re-taken without waiting by
  -- the helper below.
  PERFORM 1 FROM public.sessions f
  WHERE f.id IN (SELECT s.family_id FROM public.sessions s
                 WHERE s.user_id = p_user_id AND s.revoked_at IS NULL)
  ORDER BY f.id FOR UPDATE;

  PERFORM 1 FROM public.sessions s
  WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
  ORDER BY s.id FOR UPDATE;

  -- Now the status flip (the users lock comes LAST, after all session locks).
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;
  UPDATE public.users SET status = p_status WHERE id = p_user_id AND status IS DISTINCT FROM p_status;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    -- No-op (same status): nothing changed, nothing to revoke; callers answer 404 vs 200.
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;
  -- Status actually flipped: revoke every session in the same commit, helper order (locks
  -- already held above; the helper re-takes the advisory and the session locks without
  -- waiting). The reason stamps why: the reset reason when recovery revoked them,
  -- membership_status for plain lifecycle flips.
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, COALESCE(p_reason, 'membership_status'));
  -- The acceptance audit lands in the same commit as the status flip + revocation (INV-10):
  -- a disabled account without its audit row, or an audit row without the disable, is a
  -- half-state no retry can distinguish. The audit DEFINER reads the tenant from
  -- app.current_org(), so the caller must be inside withTenant for the target's organisation
  -- — which the controller is (HIGH1: caller-tenant membership, locked row, same commit).
  -- Correlation + session_count forwarding is verbatim from 0020's rewrite of this setter:
  -- the audit writer reads app.correlation_id set transaction-locally by withTenant, and
  -- the revoked session count rides args_sanitized (opaque count, INV-12).
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api',
    CASE WHEN p_status = 'disabled' THEN 'account.disable' ELSE 'account.enable' END,
    'user', p_user_id, '{}', '{}',
    jsonb_build_object('session_count', v_revoked),
    'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN QUERY SELECT true, v_revoked;
END
$$;
