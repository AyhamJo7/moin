-- 0021 — acceptance audit forwards the request correlation (P06.10.03, INV-10).
--
-- 0018 wrote NULL for the correlation while the 0020 recovery writers forward
-- `app.correlation_id` (Codex PR45 finding). Applied migrations are immutable, so this
-- replaces the `accept_invitation` body whole (CREATE OR REPLACE, same signature) with the
-- one-line change: NULL becomes NULLIF(current_setting('app.correlation_id', true), '')::uuid.
-- withTenant sets the setting transaction-locally; empty (unset) reads back NULL rather than
-- failing the write.

CREATE OR REPLACE FUNCTION app.accept_invitation(
  p_invitation_id uuid,
  p_token_hash bytea,
  p_subject text,
  p_email citext,
  p_actor_id uuid,
  p_event_id uuid
) RETURNS TABLE (membership_id uuid, user_id uuid, outcome text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_user_id uuid;
  v_membership_id uuid;
  v_audit_seq bigint;
BEGIN
  IF p_invitation_id IS NULL OR p_token_hash IS NULL OR p_subject IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'invitation, token, subject and email are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One serialisation point per invitation: concurrent presentations queue holding nothing else
  -- yet, so exactly one consumes. Different invitations never contend.
  PERFORM pg_advisory_xact_lock(hashtext('invitation:' || p_invitation_id::text));

  -- The token binds the presentation: an id alone (it appears in the link and in audit targets)
  -- opens nothing. A wrong digest is indistinguishable from an unknown invitation.
  SELECT * INTO v_inv FROM public.invitations i
    WHERE i.id = p_invitation_id AND i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'not_found'::text;
    RETURN;
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    -- Own retry: the winner's subject re-presenting finds their membership, not an error.
    SELECT m.id, m.user_id INTO v_membership_id, v_user_id
      FROM public.memberships m JOIN public.users u ON u.id = m.user_id
      WHERE m.organisation_id = v_inv.organisation_id AND u.cognito_sub = p_subject;
    IF FOUND AND v_membership_id IS NOT NULL THEN
      RETURN QUERY SELECT v_membership_id, v_user_id, 'already_accepted'::text;
    ELSE
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'consumed'::text;
    END IF;
    RETURN;
  END IF;

  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'revoked'::text;
    RETURN;
  END IF;

  IF v_inv.expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'expired'::text;
    RETURN;
  END IF;

  IF v_inv.email <> p_email THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'email_mismatch'::text;
    RETURN;
  END IF;

  -- Bind the identity: existing subject keeps their row (email refreshed to the verified
  -- address), a new subject gets one. The subject pattern mirrors the users CHECK in 0012.
  IF p_subject !~ '^[!-~]{1,255}$' THEN
    RAISE EXCEPTION 'invalid subject' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT u.id INTO v_user_id FROM public.users u WHERE u.cognito_sub = p_subject;
  IF NOT FOUND THEN
    v_user_id := gen_random_uuid();
    INSERT INTO public.users (id, cognito_sub, email, status)
      VALUES (v_user_id, p_subject, p_email, 'active');
  ELSE
    UPDATE public.users SET email = p_email WHERE id = v_user_id;
  END IF;

  -- A person invited twice (two invitations, one subject) keeps one membership: the second
  -- accept refreshes role and permissions rather than duplicating the row.
  SELECT m.id INTO v_membership_id FROM public.memberships m
    WHERE m.organisation_id = v_inv.organisation_id AND m.user_id = v_user_id;
  IF FOUND THEN
    UPDATE public.memberships
      SET role = v_inv.role, permissions = v_inv.permissions, status = 'active',
          updated_at = now(), version = version + 1
      WHERE id = v_membership_id;
  ELSE
    v_membership_id := gen_random_uuid();
    INSERT INTO public.memberships (organisation_id, id, user_id, role, permissions, status)
      VALUES (v_inv.organisation_id, v_membership_id, v_user_id, v_inv.role, v_inv.permissions,
              'active');
  END IF;

  UPDATE public.invitations SET accepted_at = clock_timestamp() WHERE id = v_inv.id;

  -- The acceptance audit lands in the same commit as the consume (INV-10): an accepted
  -- invitation without its audit row, or an audit row without the consume, is a half-state no
  -- retry can distinguish. `already_accepted` retries do NOT re-audit: the first accept wrote
  -- the row, and a second row would claim the membership was created twice.
  -- Forwards the tenant transaction's correlation like the 0020 recovery writers: every row of
  -- one request is findable by one id (INV-10, P06.10.03). NULLIF keeps an unset correlation
  -- from failing the write.
  v_audit_seq := app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'invitation.accept',
    'invitation', v_inv.id, '{}', '{}', '{}', 'succeeded', NULL,
    NULLIF(current_setting('app.correlation_id', true), '')::uuid, NULL
  );

  RETURN QUERY SELECT v_membership_id, v_user_id, 'accepted'::text;
END
$$;
