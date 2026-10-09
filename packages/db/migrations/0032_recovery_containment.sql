-- 0032 — recovery containment: GUC-bound tenant check + correlation on revoke path (P06.09 H1/M1).

-- ## What was wrong (QG-09 §7, EV-P06-072)
--
-- H1/M1: `app.revoke_member_sessions` trusted its `p_organisation_id` parameter — any caller
-- that can reach the DEFINER could name any organisation. The controller passes the guarded
-- session's tenant (INV-02, proven by cross-tenant tests), but the function itself never
-- verified it. Fix: refuse when the parameter disagrees with the transaction's tenant GUC
-- (`app.current_org()`, set by `withTenant`), so a forged parameter fails closed at the
-- database layer regardless of the caller. `set_user_status` needs no parameter to check —
-- its tenant binding is the audit writer's `current_org()` read, and the controller's
-- caller-tenant membership gate (locked row, same commit) is the containment; documented
-- here, unchanged.
-- L1: `revoke_member_sessions` passed NULL correlation while the sibling recovery writers
-- (0020, 0027) forward `app.correlation_id` — one request's rows were not findable by one
-- id. Fix: forward NULLIF(current_setting('app.correlation_id', true), '')::uuid like the
-- siblings, and carry the revoked session count in args_sanitized (opaque count, INV-12).
--
-- Lock order (arch H1): 0027 Ralph already reordered `set_user_status` and
-- `revoke_user_sessions` to advisory → families → sessions → users last; this migration
-- changes no lock acquisition — the added GUC read takes no lock.
--
-- No signature, owner, grant or search_path change. Catalog REVIEWED_BODIES digest for
-- `app.revoke_member_sessions` moves to the new text (see the catalog change in this PR).

CREATE OR REPLACE FUNCTION app.revoke_member_sessions(
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
  -- Containment at the database layer (H1/M1): the named organisation must be the
  -- transaction's own tenant. `withTenant` sets `app.organisation_id` transaction-locally;
  -- a caller outside it (or naming another tenant) fails closed here, not downstream.
  IF p_organisation_id IS DISTINCT FROM app.current_org() THEN
    RETURN QUERY SELECT 'missing'::text, 0;
    RETURN;
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
  -- Revoke via the shared helper: advisory → families → sessions, the 0016/0027 order. The
  -- helper re-takes the advisory (re-entrant in-session) and the session locks (already held
  -- here only via the membership row — no user-row prelock, so no AB-BA against readers).
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, p_reason);
  -- Audit in the same commit (INV-10): the tenant comes from app.current_org() — the caller
  -- is inside withTenant for the target's organisation. Correlation forwarded like the 0020
  -- recovery writers so every row of one request is findable by one id (P06.10.03); the
  -- revoked session count rides args_sanitized (opaque count, INV-12).
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'account.revoke_sessions',
    'user', p_user_id, '{}', '{}',
    jsonb_build_object('session_count', v_revoked),
    'succeeded', NULL, NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN QUERY SELECT 'done'::text, v_revoked;
END
$$;
