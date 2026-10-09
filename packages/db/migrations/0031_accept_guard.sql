-- 0031 — accept-invitation guard: no reactivation of disabled members, canonical
-- per-user serialisation with disable paths (P06.08 H1/H4).
--
-- ## What was wrong (QG-09 §6, EV-P06-071)
--
-- H1: `app.accept_invitation` reactivated any existing membership unconditionally
-- (`status = 'active'`): a pending invitation could resurrect a disabled or removed
-- member. Fix: when a membership already exists for the subject in the org, accept is
-- allowed only if the membership is active AND the user account is active; otherwise
-- the outcome is `rejected` and nothing is written (invitation stays outstanding).
-- H4: accept locked/updated `users` then `memberships`, while disable paths lock
-- memberships then users/sessions — opposite order, deadlock-prone. Fix: take the
-- per-user advisory xact lock FIRST (same keyspace as the 0016 session writers:
-- `hashtext(user-id)`), before the invitation predicate lock, so accept and disable
-- serialise on the user rather than deadlocking on rows.
--
-- No signature, owner, grant or search_path change. Catalog REVIEWED_BODIES digest
-- moves to the new text (see the catalog change in this PR).

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
  v_user_status text;
  v_membership_id uuid;
  v_membership_status text;
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
  SELECT u.id, u.status INTO v_user_id, v_user_status FROM public.users u WHERE u.cognito_sub = p_subject;
  IF NOT FOUND THEN
    v_user_id := gen_random_uuid();
    INSERT INTO public.users (id, cognito_sub, email, status)
      VALUES (v_user_id, p_subject, p_email, 'active');
    v_user_status := 'active';
  ELSE
    UPDATE public.users SET email = p_email WHERE id = v_user_id;
    -- H4: canonical per-user serialisation — same keyspace as the 0016 session
    -- writers (`hashtext(user-id)`), taken before any membership row is touched, so
    -- accept and disable paths queue on the user instead of deadlocking on rows.
    PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  END IF;

  -- H1: a pending invitation never resurrects a non-active membership or a non-active
  -- user. The invitation stays outstanding; the outcome names the refusal.
  SELECT m.id, m.status INTO v_membership_id, v_membership_status
    FROM public.memberships m
    WHERE m.organisation_id = v_inv.organisation_id AND m.user_id = v_user_id;
  IF FOUND THEN
    IF v_membership_status IS DISTINCT FROM 'active' OR v_user_status IS DISTINCT FROM 'active' THEN
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'rejected'::text;
      RETURN;
    END IF;
    UPDATE public.memberships
      SET role = v_inv.role, permissions = v_inv.permissions, status = 'active',
          updated_at = now(), version = version + 1
      WHERE id = v_membership_id;
  ELSE
    IF v_user_status IS DISTINCT FROM 'active' THEN
      RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'rejected'::text;
      RETURN;
    END IF;
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
  v_audit_seq := app.append_audit_event(
    COALESCE(p_event_id, gen_random_uuid()), p_actor_id, 'api', 'invitation.accept',
    'invitation', v_inv.id, '{}', '{}', '{}', 'succeeded', NULL, NULL, NULL
  );

  RETURN QUERY SELECT v_membership_id, v_user_id, 'accepted'::text;
END
$$;
