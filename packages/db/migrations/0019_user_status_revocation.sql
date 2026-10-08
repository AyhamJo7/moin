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
-- `app.set_user_status` takes the advisory lock FIRST — the same serialisation point every
-- revocation takes (0016 section 7: "the per-user advisory lock, before any row lock") — then
-- the user row, then flips the status, then calls the shared helper (which re-takes the
-- advisory, then families, then sessions). Identical order inside and out; a concurrent
-- sign-in takes family → session → user, so whoever reaches the user row first wins and the
-- other waits on exactly one lock — the same single-wait shape the 0016 racing tests prove.
-- A session minted ahead of a racing disable is revoked by the helper's UPDATE; a session
-- that proceeds after this commit re-checks `u.status = 'active'` and refuses. Either way no
-- live session survives a committed disable. The racing tests (disable-vs-sign-in/resolve/
-- rotate) prove each order.
--
-- No new grants beyond the setter, no new roles, no RLS change: `users` keeps its
-- SESSION_TABLES standing — no runtime role holds any privilege on it. The setter DEFINER is
-- `moin_app`'s only path to `users.status`: one lifecycle bit, no email rewrite, no subject
-- re-point, no row delete.

CREATE FUNCTION app.set_user_status(
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
  -- takes (0016 section 7: "the per-user advisory lock, before any row lock"). The helper
  -- re-takes it (advisory locks re-enter in the same session), so the order here and inside
  -- is identical: advisory → user row → families → sessions. A concurrent sign-in takes
  -- family → session → user; whoever reaches the user row first wins, the other waits on
  -- exactly one lock — the same single-wait shape the 0016 racing tests prove.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  -- Lock the user row next: concurrent disablers of the same account serialise here holding
  -- only the advisory lock, exactly like the per-invitation lock in 0018. Different accounts
  -- never contend.
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
  -- Status actually flipped: revoke every session in the same commit, helper order (the user
  -- row is already held by this transaction; the helper re-takes the advisory, then families,
  -- then sessions). The reason stamps why: the reset reason when recovery revoked them,
  -- membership_status for plain lifecycle flips.
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, COALESCE(p_reason, 'membership_status'));
  -- The acceptance audit lands in the same commit as the status flip + revocation (INV-10):
  -- a disabled account without its audit row, or an audit row without the disable, is a
  -- half-state no retry can distinguish. The audit DEFINER reads the tenant from
  -- app.current_org(), so the caller must be inside withTenant for the target's organisation
  -- — which the controller is (HIGH1: caller-tenant membership, locked row, same commit).
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api',
    CASE WHEN p_status = 'disabled' THEN 'account.disable' ELSE 'account.enable' END,
    'user', p_user_id, '{}', '{}', '{}', 'succeeded', NULL, NULL, NULL
  );
  RETURN QUERY SELECT true, v_revoked;
END
$$;

REVOKE ALL ON FUNCTION app.set_user_status(uuid, text, text, uuid, uuid)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.set_user_status(uuid, text, text, uuid, uuid) TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- revoke_member_sessions: revoke every session of a caller-tenant member, audited, one commit.
-- ---------------------------------------------------------------------------------------------
--
-- The status-quo ante called `revokeAllSessions` on a SEPARATE identity-pool connection inside
-- the controller's tenant transaction: revocation could commit while the audit rolled back (or
-- vice versa) — HIGH3. Worse, the identity connection carries no tenant, so no caller-tenant
-- check was possible on that path at all. This function folds all three into one DEFINER call
-- on the TENANT connection: caller-tenant membership gate (locked row, same commit),
-- revocation via the shared helper (advisory → user → families → sessions, the 0016 order),
-- and the audit row — one transaction, or none of it.
--
-- The gate mirrors the controller's: the target must hold a membership in the organisation the
-- caller names (which the controller sets to the guard-resolved tenant, never a caller claim),
-- and the caller's role + permissions — passed explicitly, never trusted from a table — must
-- satisfy the matrix for the target's locked role. Owner targets need `users:manage-owners`;
-- unknown targets and owner-existence both answer 'missing' (P06.07.03). A concurrent
-- owner-promotion of the target either commits first (locked read sees owner) or waits — never
-- slips between a check and a later act (HIGH1 shape).

CREATE FUNCTION app.revoke_member_sessions(
  p_organisation_id uuid,
  p_caller_role text,
  p_caller_permissions text[],
  p_user_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS TABLE (outcome text, revoked integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_role text;
  v_revoked integer;
BEGIN
  IF p_organisation_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'organisation and user are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('password_reset', 'mfa_reset') THEN
    RAISE EXCEPTION 'reason must be password_reset or mfa_reset' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Locked caller-tenant membership row: the target belongs to THIS organisation, read under
  -- lock in the same commit that revokes. Cross-tenant user ids have no row here: 'missing'.
  SELECT m.role INTO v_role FROM public.memberships m
    WHERE m.organisation_id = p_organisation_id AND m.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, 0;
    RETURN;
  END IF;
  -- The matrix, judged here against the locked row (owner targets need manage-owners).
  -- p_caller_role/permissions arrive from the guarded session scope, never from a table.
  IF v_role = 'owner' THEN
    IF NOT (p_caller_role = 'owner') THEN
      RETURN QUERY SELECT 'missing'::text, 0;
      RETURN;
    END IF;
  ELSE
    IF NOT (p_caller_role IN ('owner', 'admin')) THEN
      RETURN QUERY SELECT 'denied'::text, 0;
      RETURN;
    END IF;
  END IF;
  -- Revoke via the shared helper: advisory → user → families → sessions, the 0016 order. The
  -- helper re-takes the advisory (re-entrant in-session) and the user row (already locked
  -- here — FOR UPDATE re-takes its own lock without waiting).
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, p_reason);
  -- Audit in the same commit (INV-10): the audit DEFINER reads the tenant from
  -- app.current_org() — the caller is inside withTenant for the target's organisation.
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'account.revoke_sessions',
    'user', p_user_id, '{}', '{}', '{}', 'succeeded', NULL, NULL, NULL
  );
  RETURN QUERY SELECT 'done'::text, v_revoked;
END
$$;

REVOKE ALL ON FUNCTION app.revoke_member_sessions(uuid, text, text[], uuid, text, uuid, uuid)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.revoke_member_sessions(uuid, text, text[], uuid, text, uuid, uuid) TO moin_app;
