-- 0019 — account disablement revokes sessions (P06.09.02, INV-01).
--
-- ## The gap 0016 named
--
-- "A user's own `status` is not watched: no runtime role can write `users`" — and now one path
-- can: `app.set_user_status` below, executed by `moin_app`. Without revocation on the account
-- row, disabling then re-enabling would revive old sessions: `resolve_session` re-checks
-- `u.status = 'active'`, so a disabled user's sessions stop resolving — but the rows stay
-- unrevoked, and re-enabling flips them live again. The 0016 membership trigger has no such
-- hole (status lives on the same row it watches); the account row needs its own revocation.
--
-- ## Why a trigger cannot do this
--
-- An AFTER UPDATE trigger on `users` runs holding the user UPDATE lock, then waits on session
-- rows — while every session function holds session rows and waits on the user row (FOR SHARE).
-- AB-BA, proven by the racing tests both ways (disable-vs-sign-in/resolve/rotate deadlock when
-- the trigger takes session locks, even inline without the helper). So there is NO trigger on
-- `users`: the revocation rides the writer instead.
--
-- ## The writer order (deadlock-free)
--
-- `app.set_user_status` locks the user row FIRST — before any session function touches those
-- session rows for this op — then flips the status, then calls the same revoke helper the reset
-- overload uses: user row (already held), then families, then sessions, the helper's own order.
-- One transaction, one direction: whoever locks the user row first wins, the other waits on
-- exactly one lock. A session minted ahead of a racing disable is revoked by the helper's
-- UPDATE; a session that proceeds after this commit re-checks `u.status = 'active'` and
-- refuses. Either way no live session survives a committed disable. The racing tests
-- (disable-vs-sign-in/resolve/rotate) prove each order.
--
-- No new grants beyond the setter, no new roles, no RLS change: `users` keeps its
-- SESSION_TABLES standing — no runtime role holds any privilege on it. The setter DEFINER is
-- `moin_app`'s only path to `users.status`: one lifecycle bit, no email rewrite, no subject
-- re-point, no row delete.

CREATE FUNCTION app.set_user_status(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
) RETURNS TABLE (changed boolean, revoked integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_status IS NULL OR p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'user id and active/disabled status are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Lock the user row first: concurrent disablers of the same account serialise here holding
  -- nothing else yet, exactly like the per-invitation lock in 0018. Different accounts never
  -- contend.
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
  -- Status actually flipped: revoke every session in the same commit, helper order (families,
  -- then sessions — the user row is already held by this transaction). The reason stamps why:
  -- the reset reason when recovery revoked them, membership_status for plain lifecycle flips.
  IF p_reason IS NOT NULL AND p_reason NOT IN ('password_reset', 'mfa_reset') THEN
    RAISE EXCEPTION 'reason must be password_reset or mfa_reset'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY SELECT true, app.revoke_user_sessions(p_user_id, NULL, COALESCE(p_reason, 'membership_status'));
END
$$;

REVOKE ALL ON FUNCTION app.set_user_status(uuid, text, text)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.set_user_status(uuid, text, text) TO moin_app;
