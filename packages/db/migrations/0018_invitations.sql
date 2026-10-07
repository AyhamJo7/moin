-- 0018 — invitations: who may join which organisation (P06.08.01, P06.08.02, INV-01).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Tenant rows, like memberships
--
-- An invitation names an organisation, an email address, a role (and optional permissions), and a
-- window in which it may be used. It carries `organisation_id`, is under the single tenant policy
-- via `app.apply_tenant_rls`, and is NOT on the global register: an invitation for one tenant must
-- never be visible — or usable — from another.
--
-- ## The token is a digest, never the value
--
-- Like every secret in this schema (0012 header): the issuer mints 256 bits, the database keeps
-- only the SHA-256 digest (`token_hash`, bytea, UNIQUE per tenant), and the value travels to the
-- invitee out of band. A reader of this table cannot produce an invitation link. The raw token is
-- returned to the issuer once, at creation, and never logged (INV-12, INV-15).
--
-- ## Single use, bounded life
--
-- `expires_at` is 7 days after `created_at`, enforced by CHECK against the row's own timestamp so
-- the lifetime is a property of the data, not of the caller's arithmetic. `accepted_at` is set
-- exactly once by `accept_invitation`: a second presentation of the same token finds the row
-- already consumed and fails. `revoked_at` lets an owner cancel an outstanding invitation; a
-- revoked invitation is as unusable as an expired one.
--
-- ## Acceptance is atomic and idempotent
--
-- `app.accept_invitation` runs as SECURITY DEFINER with one advisory lock on the invitation id:
-- concurrent presentations of the same token serialise, exactly one wins the consume, and a retry
-- of the winner's own commit returns the same membership rather than a duplicate (INV-11). It
-- creates the `users` row when the subject is new (sign-in never does, 0012 header), links the
-- membership, and marks the invitation consumed — all in one transaction, or none of it.
--
-- The email match is exact on the normalised address: the provider vouches `email` with
-- `email_verified = true` (identity-claims contract), the application lower-cases it, and the
-- function compares against the invitation's citext column. No fuzzy matching (INV-09).
--
-- No new roles, no RLS change beyond the new table's own policy. `moin_app` writes invitations and
-- consumes them through the DEFINER inside withTenant; `moin_identity` gains no grant. HOW an
-- unauthenticated invitee reaches this function (the organisation is not known before the token is
-- read) is an open design decision recorded in PROGRESS.md, not settled here.

CREATE TABLE invitations (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  token_hash      bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
  email           citext      NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role            text        NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  permissions     text[]      NOT NULL DEFAULT '{}'
    CHECK (permissions <@ ARRAY['integration_admin', 'billing_admin']),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_by      uuid,
  CONSTRAINT invitations_lifetime CHECK (expires_at = created_at + interval '7 days'),
  CONSTRAINT invitations_single_outcome CHECK (
    NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, token_hash)
);

CREATE INDEX invitations_token_idx ON invitations (organisation_id, token_hash)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_email_idx ON invitations (organisation_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE invitations IS
  'Who may join which organisation (P06.08). Tenant rows: token stored as SHA-256 digest, 7-day life, single use via accepted_at, cancellable via revoked_at.';

SELECT app.apply_tenant_rls('invitations');

REVOKE ALL ON TABLE invitations
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON invitations TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- accept_invitation: consume a token, bind the identity, create the membership.
-- ---------------------------------------------------------------------------------------------
--
-- Called by moin_app inside withTenant (the organisation is the guarded session's own). Locks the
-- invitation row first (FOR UPDATE), so two concurrent presentations serialise on the row: the
-- loser sees accepted_at already set and gets 'consumed'. The checks after the lock are the
-- contract: revoked → 'revoked', expired by the database clock → 'expired', email mismatch →
-- 'email_mismatch'. The clock is the database's own (caller-supplied time is never trusted), and
-- the email arrives already normalised by the application (lower-cased verified provider claim).
--
-- Idempotency (INV-11): the same subject presenting the same token twice — a retried accept after
-- a lost response — returns the same membership ('already_accepted') instead of failing or
-- duplicating. The UNIQUE (organisation_id, user_id) on memberships is the backstop, but this
-- path never reaches it twice for one invitation.
--
-- A new person gets a users row here, and only here: sign-in refuses unknown subjects (0012), so
-- the accept flow is the single provisioning path for invited members. An existing subject keeps
-- their row; email is refreshed to the verified address.

CREATE FUNCTION app.accept_invitation(
  p_invitation_id uuid,
  p_token_hash bytea,
  p_subject text,
  p_email citext
) RETURNS TABLE (membership_id uuid, user_id uuid, outcome text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_user_id uuid;
  v_membership_id uuid;
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

  IF v_inv.expires_at <= now() THEN
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

  UPDATE public.invitations SET accepted_at = now() WHERE id = v_inv.id;

  RETURN QUERY SELECT v_membership_id, v_user_id, 'accepted'::text;
END
$$;

REVOKE ALL ON FUNCTION app.accept_invitation(uuid, bytea, text, citext)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.accept_invitation(uuid, bytea, text, citext) TO moin_app;
