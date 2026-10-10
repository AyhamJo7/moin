-- 0033 — recovery audit payload: reason + previous status (P06.09 L1).
--
-- 0020 wrote `session_count` only. The reset reason (`password_reset`/`mfa_reset`)
-- and the previous account status are audit-relevant and already validated Flint --
-- `p_reason` is allowlisted to two values, `p_status` to active/disabled -- so both
-- are opaque by construction (INV-12) and safe to record. This replaces the
-- `set_user_status` body whole (CREATE OR REPLACE, same signature): capture the
-- previous status before the UPDATE, forward both fields into the audit args, and
-- extend the allowlist with the two new keys (same migration, before the function
-- so a fresh migrate never sees an unallowlisted key).

-- `reason` and `previous_status` are validated enums at the call site; the audit
-- writer only knows uuid/boolean/count, so both travel as opaque booleans:
-- `was_password_reset` (reason = password_reset) and `was_active_before`
-- (previous_status = active). No free text ever reaches the audit row.

INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('account.disable', 'was_password_reset', 'boolean', 'reset reason was password_reset as opposed to mfa_reset; boolean, no identity'),
  ('account.disable', 'was_active_before', 'boolean', 'account was active before the flip; boolean, no identity'),
  ('account.enable', 'was_password_reset', 'boolean', 'reset reason was password_reset as opposed to mfa_reset; boolean, no identity'),
  ('account.enable', 'was_active_before', 'boolean', 'account was active before the flip; boolean, no identity')
ON CONFLICT (operation, argument_key) DO NOTHING;

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
  v_previous text;
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
  SELECT u.status INTO v_previous FROM public.users u WHERE u.id = p_user_id;
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
    jsonb_build_object(
      'session_count', v_revoked,
      'was_password_reset', COALESCE(p_reason, 'membership_status') = 'password_reset',
      'was_active_before', v_previous = 'active'
    ),
    'succeeded', NULL, v_correlation, NULL
  );
  RETURN QUERY SELECT true, v_revoked;
END
$$;
