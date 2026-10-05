-- 0014 — the per-request session + membership lookup (P06.06.03, FS-16, INV-02).
--
-- ## One query, one clock, no caller trust
--
-- Every request re-checks session validity and membership status in a single call. The function
-- takes only the session token digest the browser presented — never an organisation id, user id,
-- role or permission — and returns the active memberships it finds. Tenant resolution therefore
-- stays server-side (INV-02): the organisation the request acts for comes out of this function,
-- never out of a body, query string or header.
--
-- Validity is the same conjunction `resolve_session` enforces: unrevoked, idle and absolute
-- expiry both future against the database clock read after the locks, owning user active. A
-- membership row counts only when `status = 'active'`: a removed member has no row, a disabled
-- or suspended one is refused — either way the next request finds nothing (FS-16) without any
-- session sweep, because no request trusts a session without calling here first.
--
-- Activity is recorded in the same call through the same capped slide `resolve_session`
-- performs: `last_seen_at` moves to now, `idle_expires_at` to `now + 12 h` capped by the
-- absolute expiry, skipped when the advance would be under a minute (one write per burst, never
-- later than ideal). A read-only re-check therefore keeps the 12-hour idle contract exactly as
-- `resolve_session` does — there is no second call whose result could be discarded, and no
-- expiry that can lapse between a read and a separate write (single query, single `v_now`).
--
-- ## Why the membership read needs a scoped policy exception
--
-- `memberships` is under FORCE RLS, and this lookup runs before any tenant is known — setting one
-- tenant inside would defeat the multi-membership fail-closed rule the guard enforces, and
-- `SET row_security = off` on the function is refused by the planner for a FORCE table. So the
-- memberships policy carries one additional USING disjunct: the function sets a transaction-local
-- marker (`app.request_lookup = 'resolve_request_context'`) around its own membership read, and
-- the disjunct additionally requires `current_user = 'moin_migrator'` — which holds only inside
-- code running as this DEFINER's owner. No runtime role can use it: `moin_identity` has no table
-- grant at all, and `moin_app` never runs as the migrator. The marker is reset before every
-- RETURN, so it cannot leak into the caller's transaction. The whole exemption — marker set,
-- read, reset — is visible in the body the `REVIEWED_BODIES` digest pins.
--
-- ## Lock order follows the canonical graph
--
-- Family, then target session, then owning user — the same order as `begin_session`,
-- `rotate_session` and `resolve_session` — so a re-check racing a rotation, re-login or disable
-- serialises instead of deadlocking. Membership rows need no lock: they are read, never written,
-- by this function, and a concurrent disable commits either before the read (row refused) or
-- after (next request refuses). Either way no live request outlives its membership.

CREATE FUNCTION app.resolve_request_context(
  p_token_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, organisation_id uuid, role text,
                 permissions text[], idle_expires_at timestamptz,
                 absolute_expires_at timestamptz)
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

  -- Fresh DB clock obtained only after all locks above are held.
  v_now := clock_timestamp();

  -- Scoped read marker for the membership join below. Set and read inside one subtransaction:
  -- the inner block resets the marker before re-raising, so no error path can leak it into the
  -- caller's transaction where a later read as the function owner would inherit the exception.
  BEGIN
    -- The capped activity slide, folded in so validity and write share one v_now: a session that
    -- lapses between a separate read and write could be admitted-then-slid; here the write IS the
    -- verdict. Skipped under a minute like resolve_session — never later than ideal. Runs before
    -- the marker is set: sessions/users are global, so the write needs no exemption, and the
    -- exemption window covers exactly the membership join below.
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

    PERFORM set_config('app.request_lookup', 'resolve_request_context', true);

    RETURN QUERY
    SELECT s.id, s.user_id, m.organisation_id, m.role, m.permissions,
           s.idle_expires_at, s.absolute_expires_at
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
-- Execution: moin_identity only, by exact signature — the seventh session function (QG-09 I1).
-- moin_app is revoked explicitly, so the voice/worker role can neither resolve a request context
-- nor reach around the guard.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.resolve_request_context(bytea) FROM PUBLIC, moin_app;

GRANT EXECUTE ON FUNCTION app.resolve_request_context(bytea) TO moin_identity;
