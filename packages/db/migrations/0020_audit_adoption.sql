-- 0020 — audit writer adoption: correlation and argument allowlists (P06.10.03, INV-10).
--
-- ## What this migration does, and what it deliberately does not
--
-- Two gaps, both adoption — no new tables, no new functions, no grant changes:
--
-- 1. `correlation_id` is NULL on every audit row whose writer passes none. `MemberQueries.inScope`
--    already threads the request correlation through `withTenant` (application change, same
--    branch), but the three in-database writers — invitation acceptance (0018), account
--    disable/enable (0019 `set_user_status`) and revoke-sessions (0019 `revoke_member_sessions`)
--    — hard-code NULL. This migration replaces those three bodies so each forwards the tenant
--    transaction's correlation: `current_setting('app.correlation_id', true)`, set alongside
--    `app.organisation_id` by `withTenant`. Empty string (unset) becomes NULL; the setting is
--    transaction-local like the tenant, so it cannot leak across pooled checkouts.
-- 2. The `audit_argument_allowlist` holds no production rows: every writer passes `'{}'`, so the
--    per-operation allowlist control has never admitted a real argument. This migration seeds
--    the reviewed keys for the recovery operations — `session_count` (count) on
--    `account.disable`, `account.enable` and `account.revoke_sessions` — and the three writers
--    pass it. One key, one kind, opaque by construction: a count of revoked sessions names no
--    person, address or secret (INV-12).
--
-- Session issue/rotate/revoke stay unaudited by decision (founder-approved scope for this
-- session): those DEFINERs run with no tenant set, and `append_audit_event` requires one. The
-- honest deferral is recorded in the evidence, not worked around with a global audit row.
--
-- Bodies replaced whole (CREATE OR REPLACE), so the digest pins below move to the new text.

-- withTenant sets both settings transaction-locally; the writers read the correlation back.
-- (No DDL here: this documents the contract the three replacements rely on.)

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
  v_correlation uuid;
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
  -- takes (0016 section 7: "the per-user advisory lock, before any row lock").
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;
  UPDATE public.users SET status = p_status WHERE id = p_user_id AND status IS DISTINCT FROM p_status;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, COALESCE(p_reason, 'membership_status'));
  v_correlation := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api',
    CASE WHEN p_status = 'disabled' THEN 'account.disable' ELSE 'account.enable' END,
    'user', p_user_id, '{}', '{}',
    jsonb_build_object('session_count', v_revoked),
    'succeeded', NULL, v_correlation, NULL
  );
  RETURN QUERY SELECT true, v_revoked;
END
$$;

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
  SELECT m.role INTO v_role FROM public.memberships m
    WHERE m.organisation_id = p_organisation_id AND m.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, 0;
    RETURN;
  END IF;
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
  v_revoked := app.revoke_user_sessions(p_user_id, NULL, p_reason);
  PERFORM app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'account.revoke_sessions',
    'user', p_user_id, '{}', '{}',
    jsonb_build_object('session_count', v_revoked),
    'succeeded', NULL, NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );
  RETURN QUERY SELECT 'done'::text, v_revoked;
END
$$;

-- The reviewed argument keys for the recovery operations (P06.10.03, P06.10.07). One key, one
-- kind: `session_count` is a bounded count of revoked sessions — opaque by construction, no
-- person, address or secret (INV-12). Empty-args writers need no row and get none.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('account.disable', 'session_count', 'count', 'how many sessions the disable revoked; opaque count, no identity'),
  ('account.enable', 'session_count', 'count', 'how many sessions the enable revoked (zero on a plain re-enable); opaque count, no identity'),
  ('account.revoke_sessions', 'session_count', 'count', 'how many sessions the revocation ended; opaque count, no identity')
ON CONFLICT (operation, argument_key) DO NOTHING;
