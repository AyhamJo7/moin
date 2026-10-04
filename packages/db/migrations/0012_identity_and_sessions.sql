-- 0012 — users, sign-in transactions and server-side sessions (P06.06.01, P06.06.02, ADR-0005).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
-- migration-check: allow drop-table because session_clock_policy exists only in pre-merge revisions of this same unreleased migration (never on main), and the DROP is IF EXISTS guarded, so it is a no-op everywhere except a dirty dev/CI database migrated mid-review.
--
-- ## Identity, not tenancy
--
-- A session says *who* is signed in. It does not say which organisation they act for or what they
-- may do there: memberships, roles and permissions are tenant data in our own tables (ADR-0005,
-- INV-02), and the per-request membership check is P06.06.03. So none of these tables has an
-- `organisation_id`, none is under a tenant policy, and each is on the global register with that
-- reason. A token claim never reaches any column here except the provider subject, which the
-- reviewed identity-claims parser (P06.05.04) has already reduced to `sub`.
--
-- ## A role of its own, and no table grant
--
-- The six functions below are executable by **`moin_identity` alone** — the api task's second pool
-- (ADR-0003 amendment, QG-09 finding I1). `moin_app` is also the voice and worker role, and a session
-- function it could execute is a session any compromised voice or worker process could mint. So
-- `moin_app` gets no EXECUTE here at all, and `moin_identity` gets those six and nothing else: no
-- table privilege, no tenant table, no membership in any role, no ownership.
--
-- Neither role holds a privilege on the tables. The default privileges from 0003 would have given
-- `moin_app` DML, so they are revoked explicitly below. Every read and write goes through one of the
-- six `SECURITY DEFINER` functions, each of which does one thing and returns the minimum (PLAN Data
-- Architecture). That is what makes the security properties below properties of the database rather
-- than promises of the caller:
--
--   * a sign-in transaction is consumed exactly once, whatever the caller does;
--   * the absolute lifetime of a session cannot be extended, by any caller, ever;
--   * a revoked session cannot be revived;
--   * a session is issued only to an existing, active user — never created from a token alone.
--
-- ## Secrets are hashes or ciphertext
--
-- No column holds a value that would let a reader act. The session token, `state`, nonce and the
-- browser binding are stored as SHA-256 digests of 256-bit random values; the PKCE verifier and the
-- provider tokens are AES-256-GCM ciphertext whose key is never in the database. The application
-- supplies both; this file only enforces their shape.
--
-- ## PostgreSQL's DB clock is the sole authoritative clock
--
-- The database clock (clock_timestamp()) is authoritative for all security lifetimes and authorization
-- checks: auth transaction expiry, session idle expiry, session absolute expiry, rotation
-- eligibility, and revocation. Caller-supplied time is never accepted for authorization decisions.
-- Lifetimes are fixed here and enforced again by CHECK constraints.

-- ---------------------------------------------------------------------------------------------
-- moin_identity exists and can do nothing on its own.
-- ---------------------------------------------------------------------------------------------
--
-- Login roles are provisioned by the cluster owner (`docker/postgres/init/00-roles.sql` locally, the
-- CI role step, Terraform in P05), never by a migration — see 0003. This asserts what the grants
-- below rely on, and fails the apply naming the problem rather than granting to a role that could
-- do more than call six functions.
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    INTO r FROM pg_roles WHERE rolname = 'moin_identity';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'missing database role moin_identity. It is provisioned by the cluster owner (docker/postgres/init/00-roles.sql locally, Terraform in P05), not by migrations.';
  END IF;
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN
    RAISE EXCEPTION
      'moin_identity must be NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION: it executes the session functions and nothing else.';
  END IF;
  -- A member of no role: membership would extend what it may do.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'moin_identity')
  ) THEN
    RAISE EXCEPTION
      'moin_identity must be a member of no role: membership would extend what it may do.';
  END IF;
  -- No role may use it. The one grant tolerated is the one PostgreSQL 16+ records by itself when a
  -- CREATEROLE non-superuser — the RDS master user — creates a role: ADMIN only, with neither
  -- INHERIT nor SET. ADMIN still lets its holder grant the role onward, itself included, so the
  -- holder must be that kind of role and nothing else: CREATEROLE, not one of ours, and not
  -- reachable from any of our runtime roles. Every other member is refused.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles h ON h.oid = m.member
    WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'moin_identity')
      AND NOT (
        m.admin_option AND NOT m.inherit_option AND NOT m.set_option
        AND h.rolcreaterole AND h.rolname NOT LIKE 'moin\_%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_roles rr
          WHERE rr.rolname IN ('moin_app', 'moin_provisioner', 'moin_dispatcher', 'moin_support_ro',
                               'moin_reporting', 'moin_readonly', 'moin_identity')
            AND pg_has_role(rr.oid, h.oid, 'MEMBER')
        )
      )
  ) THEN
    RAISE EXCEPTION
      'moin_identity must have no members, except an ADMIN-only grant (no INHERIT, no SET) to the CREATEROLE role that created it, which no moin runtime role can reach.';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, app TO moin_identity;

-- ---------------------------------------------------------------------------------------------
-- users: the link between a provider subject and a person in our model.
-- ---------------------------------------------------------------------------------------------
--
-- Rows are created by invitation acceptance (P06.08.02), not by sign-in: an authenticated subject
-- with no row here is refused, never provisioned. The subject pattern is the parser's: visible ASCII
-- only, at most 255 characters, so no whitespace or control character can make two subjects equal.
CREATE TABLE users (
  id          uuid        NOT NULL PRIMARY KEY,
  cognito_sub text        NOT NULL UNIQUE CHECK (cognito_sub ~ '^[!-~]{1,255}$'),
  email       citext      NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  status      text        NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS
  'A person, linked to the identity provider by subject. Global: one person may belong to several organisations. Created by invitation acceptance (P06.08.02); sign-in never creates a row.';

-- ---------------------------------------------------------------------------------------------
-- auth_transactions: one pending Authorization Code + PKCE sign-in.
-- ---------------------------------------------------------------------------------------------
--
-- Server-side so that it survives a restart and works across replicas; single-use by DELETE, so two
-- callbacks racing on one `state` cannot both find it. `binding_hash` ties the transaction to the
-- browser that started it (a `__Host-` cookie), so a callback URL carried to another browser — the
-- login-CSRF case — fails even with a valid `state`.
CREATE TABLE auth_transactions (
  state_hash      bytea       NOT NULL PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  binding_hash    bytea       NOT NULL CHECK (octet_length(binding_hash) = 32),
  nonce_hash      bytea       NOT NULL CHECK (octet_length(nonce_hash) = 32),
  verifier_sealed bytea       NOT NULL CHECK (octet_length(verifier_sealed) BETWEEN 29 AND 512),
  key_id          text        NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  return_to       text        NOT NULL CHECK (left(return_to, 1) = '/' AND length(return_to) <= 512),
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  CONSTRAINT auth_transactions_lifetime
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);

CREATE INDEX auth_transactions_expires_idx ON auth_transactions (expires_at);

COMMENT ON TABLE auth_transactions IS
  'Pending sign-ins: hashed state, nonce and browser binding, sealed PKCE verifier. Consumed once, by DELETE (P06.06.01).';

-- ---------------------------------------------------------------------------------------------
-- sessions: keyed by the SHA-256 of a 256-bit random token (PLAN Data Architecture).
-- ---------------------------------------------------------------------------------------------
--
-- `token_hash` is the key the cookie resolves to; `id` is an opaque identifier that is safe to log
-- and to reference. A rotation writes a new row and revokes its predecessor in the same statement;
-- `rotated_from` is UNIQUE, so a session can have at most one successor even if two rotations race.
-- `family_id` is the first session of a sign-in and is carried through every rotation, which keeps
-- the forensic lineage and is the associated data the provider-token ciphertext is bound to.
CREATE TABLE sessions (
  token_hash             bytea       NOT NULL PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  id                     uuid        NOT NULL UNIQUE,
  family_id              uuid        NOT NULL,
  user_id                uuid        NOT NULL REFERENCES users (id),
  rotation_reason        text        NOT NULL
                                     CHECK (rotation_reason IN ('login', 'step_up', 'privilege_change')),
  rotated_from           uuid        UNIQUE REFERENCES sessions (id),
  created_at             timestamptz NOT NULL,
  last_seen_at           timestamptz NOT NULL,
  idle_expires_at        timestamptz NOT NULL,
  absolute_expires_at    timestamptz NOT NULL,
  revoked_at             timestamptz,
  revocation_reason      text        CHECK (revocation_reason IN ('rotated', 'superseded', 'signed_out')),
  -- Wiped when the session is revoked: a refresh token has no business outliving the session it
  -- belongs to, and on rotation it moves to the successor rather than being copied.
  provider_tokens_sealed bytea       CHECK (octet_length(provider_tokens_sealed) BETWEEN 29 AND 65536),
  provider_tokens_key_id text        CHECK (provider_tokens_key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT sessions_revocation_complete CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CONSTRAINT sessions_provider_tokens_complete
    CHECK ((provider_tokens_sealed IS NULL) = (provider_tokens_key_id IS NULL)),
  CONSTRAINT sessions_live_session_holds_tokens
    CHECK (revoked_at IS NOT NULL OR provider_tokens_sealed IS NOT NULL),
  CONSTRAINT sessions_lineage CHECK (
    (rotation_reason = 'login') = (rotated_from IS NULL)
    AND (rotation_reason <> 'login' OR family_id = id)
  ),
  -- The ceilings T-15 sets. The functions compute the same values; these make a wrong one fail.
  CONSTRAINT sessions_seen_after_created CHECK (last_seen_at >= created_at),
  CONSTRAINT sessions_idle_ceiling CHECK (idle_expires_at <= last_seen_at + interval '12 hours'),
  CONSTRAINT sessions_idle_within_absolute CHECK (idle_expires_at <= absolute_expires_at),
  CONSTRAINT sessions_absolute_ceiling CHECK (absolute_expires_at <= created_at + interval '7 days')
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_family_idx ON sessions (family_id);

COMMENT ON TABLE sessions IS
  'Server-side sessions (ADR-0005). Keyed by SHA-256 of the cookie token; provider tokens sealed with a key that is not in the database, and wiped at revocation. Identity only: no tenant, no role.';

-- ---------------------------------------------------------------------------------------------
-- Grants: none. 0003's default privileges would have given moin_app DML on all of these.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON TABLE users, auth_transactions, sessions
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- A session's identity and lifetime are fixed at creation; revocation is final.
-- ---------------------------------------------------------------------------------------------
--
-- The functions below only ever move `last_seen_at`, `idle_expires_at`, the revocation columns,
-- and wipe the provider tokens at revocation. This makes the properties that matter most hold for
-- the table's owner as well: the absolute expiry never moves, a revoked session never becomes valid
-- again, and sealed provider tokens can be erased but never replaced.
CREATE FUNCTION app.reject_session_rewrite() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.rotation_reason IS DISTINCT FROM OLD.rotation_reason
     OR NEW.rotated_from IS DISTINCT FROM OLD.rotated_from
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at THEN
    RAISE EXCEPTION 'a session''s identity and absolute lifetime are fixed at creation'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.provider_tokens_sealed IS DISTINCT FROM OLD.provider_tokens_sealed
      OR NEW.provider_tokens_key_id IS DISTINCT FROM OLD.provider_tokens_key_id)
     AND (NEW.provider_tokens_sealed IS NOT NULL OR NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'sealed provider tokens may only be wiped, and only from a revoked session'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
    RAISE EXCEPTION 'a revoked session cannot be revived or re-revoked'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.reject_session_rewrite() FROM PUBLIC;

CREATE TRIGGER sessions_fixed_lifetime
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION app.reject_session_rewrite();
-- Fires in replica mode too, so a session setting cannot switch it off.
ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_fixed_lifetime;

-- ---------------------------------------------------------------------------------------------
-- 1. Start a sign-in.
-- ---------------------------------------------------------------------------------------------
--
-- A bounded batch of expired transactions is removed on the way in, skipping rows another sign-in
-- is already removing, so a flood of abandoned sign-ins never turns one start into a long delete.
-- Stale rows are harmless whether or not they have been removed yet: `consume_sign_in`
-- refuses an expired row either way.
CREATE FUNCTION app.begin_sign_in(
  p_state_hash bytea,
  p_binding_hash bytea,
  p_nonce_hash bytea,
  p_verifier_sealed bytea,
  p_key_id text,
  p_return_to text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  DELETE FROM public.auth_transactions
  WHERE ctid IN (
    SELECT t.ctid FROM public.auth_transactions t
    WHERE t.expires_at <= v_now
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  );
  INSERT INTO public.auth_transactions
    (state_hash, binding_hash, nonce_hash, verifier_sealed, key_id, return_to, created_at, expires_at)
  VALUES
    (p_state_hash, p_binding_hash, p_nonce_hash, p_verifier_sealed, p_key_id, p_return_to,
     v_now, v_now + interval '10 minutes');
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Consume it, exactly once.
-- ---------------------------------------------------------------------------------------------
--
-- The row is deleted on **any** presentation of its `state`, and only then are the binding and the
-- expiry compared. So a replay finds nothing, a wrong browser burns the transaction instead of
-- probing it, and an expired one is gone. A concurrent duplicate blocks on the row lock and, once
-- the first commits, deletes nothing. Retry after a failed exchange means a fresh sign-in, which is
-- the trade PLAN prefers over a replay window.
CREATE FUNCTION app.consume_sign_in(
  p_state_hash bytea,
  p_binding_hash bytea
) RETURNS TABLE (nonce_hash bytea, verifier_sealed bytea, key_id text, return_to text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  RETURN QUERY
  WITH claimed AS (
    DELETE FROM public.auth_transactions t
    WHERE t.state_hash = p_state_hash
    RETURNING t.binding_hash, t.nonce_hash, t.verifier_sealed, t.key_id, t.return_to, t.expires_at
  )
  SELECT c.nonce_hash, c.verifier_sealed, c.key_id, c.return_to
  FROM claimed c
  WHERE c.binding_hash = p_binding_hash
    AND c.expires_at > v_now;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Issue a session after a verified sign-in.
-- ---------------------------------------------------------------------------------------------
--
-- Returns no row when the subject has no active user: sign-in never provisions. The session the
-- browser already presented (`p_replaced_hash`), and every live session of its family, is revoked
-- in the same transaction, so signing in again leaves no earlier session of that browser behind.
-- (Two tabs completing sign-in at once, both presenting one old cookie, still end with two new
-- sessions; the browser keeps the last cookie. Listing and ending sessions is P06.06.05.) A value
-- the browser presented that is not a
-- session — an attacker-planted cookie — matches nothing and changes nothing: the new token is
-- always generated by the caller, never taken from the request.
CREATE FUNCTION app.begin_session(
  p_subject text,
  p_token_hash bytea,
  p_session_id uuid,
  p_provider_tokens_sealed bytea,
  p_key_id text,
  p_replaced_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, absolute_expires_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_user uuid;
  v_family uuid;
BEGIN
  -- Lock order is family first, then user, in both this function and `rotate_session`: a re-login
  -- superseding a family while a rotation of the same family is in flight takes both locks in the
  -- same order, so the two serialise instead of deadlocking (AB-BA). The user-row FOR SHARE
  -- conflicts with a concurrent disable's UPDATE: either the disable commits first and v_user is
  -- NULL, or this insert commits first. Either way no live session exists for a disabled user —
  -- `resolve_session` re-checks `u.status = 'active'`, so a session minted ahead of a racing
  -- disable stops resolving rather than living on.
  IF p_replaced_hash IS NOT NULL THEN
    SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_replaced_hash;
    IF v_family IS NOT NULL THEN
      PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;
    END IF;
  END IF;

  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.cognito_sub = p_subject AND u.status = 'active'
  FOR SHARE;
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- The family lock above is held across the user-row lock: family first, then user, matching
  -- `rotate_session`. The supersede below re-uses the already-held family lock.
  IF v_family IS NOT NULL THEN
    v_now := clock_timestamp();
    UPDATE public.sessions s
    SET revoked_at = v_now, revocation_reason = 'superseded',
        provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
    WHERE s.family_id = v_family AND s.revoked_at IS NULL;
  END IF;

  v_now := clock_timestamp();

  RETURN QUERY
  INSERT INTO public.sessions AS s
    (token_hash, id, family_id, user_id, rotation_reason, rotated_from, created_at, last_seen_at,
     idle_expires_at, absolute_expires_at, provider_tokens_sealed, provider_tokens_key_id)
  VALUES
    (p_token_hash, p_session_id, p_session_id, v_user, 'login', NULL, v_now, v_now,
     v_now + interval '12 hours', v_now + interval '7 days', p_provider_tokens_sealed, p_key_id)
  RETURNING s.id, s.user_id, s.absolute_expires_at;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Rotate: a new token for the same sign-in, after step-up or a privilege change.
-- ---------------------------------------------------------------------------------------------
--
-- One statement: the predecessor is locked, revoked and stripped of its provider tokens, and the
-- successor inserted holding them, or none of it happens. The predecessor must be valid *now*; a
-- revoked or expired session cannot be rotated back to life. The successor inherits the absolute
-- expiry, so rotation can never extend a sign-in past 7 days, and its idle expiry is capped by it.
-- Two rotations racing on one token: the second waits on the row lock, re-reads `revoked_at IS
-- NULL` as false, and inserts nothing; `rotated_from` UNIQUE is the backstop. The successor's
-- timestamps never precede the predecessor's, so a replica whose clock is slightly behind gets a
-- successor rather than a CHECK violation. The family's lock is taken first, as in `begin_session`,
-- so a rotation and a sign-in superseding the family serialise. Login has its own path.
CREATE FUNCTION app.rotate_session(
  p_token_hash bytea,
  p_new_token_hash bytea,
  p_new_session_id uuid,
  p_reason text
) RETURNS TABLE (session_id uuid, user_id uuid, absolute_expires_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_family uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('step_up', 'privilege_change') THEN
    RAISE EXCEPTION 'rotation reason must be step_up or privilege_change'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The family's lock first, as in `begin_session`: see there.
  SELECT s.family_id INTO v_family FROM public.sessions s WHERE s.token_hash = p_token_hash;
  IF v_family IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public.sessions f WHERE f.id = v_family FOR UPDATE;

  -- Lock predecessor row before evaluating validity
  PERFORM 1 FROM public.sessions s WHERE s.token_hash = p_token_hash FOR UPDATE;

  -- Lock the owning user row (FOR SHARE conflicts with a concurrent disable's UPDATE), so a
  -- disable racing this rotation serialises here rather than extending a session that should die.
  PERFORM 1
  FROM public.sessions s JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash FOR SHARE OF u;

  -- Fresh DB clock obtained after acquiring the locks
  v_now := clock_timestamp();

  RETURN QUERY
  WITH predecessor AS (
    SELECT s.token_hash, s.id, s.family_id, s.user_id, s.created_at, s.absolute_expires_at,
           s.provider_tokens_sealed, s.provider_tokens_key_id
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_now
      AND s.absolute_expires_at > v_now
      AND u.status = 'active'
  ), retired AS (
    UPDATE public.sessions s
    SET revoked_at = v_now, revocation_reason = 'rotated',
        provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
    FROM predecessor p
    WHERE s.token_hash = p.token_hash
    RETURNING s.id
  )
  INSERT INTO public.sessions AS n
    (token_hash, id, family_id, user_id, rotation_reason, rotated_from, created_at, last_seen_at,
     idle_expires_at, absolute_expires_at, provider_tokens_sealed, provider_tokens_key_id)
  SELECT p_new_token_hash, p_new_session_id, p.family_id, p.user_id, p_reason, p.id,
         GREATEST(v_now, p.created_at), GREATEST(v_now, p.created_at),
         LEAST(GREATEST(v_now, p.created_at) + interval '12 hours', p.absolute_expires_at),
         p.absolute_expires_at, p.provider_tokens_sealed, p.provider_tokens_key_id
  FROM predecessor p
  JOIN retired r ON r.id = p.id
  RETURNING n.id, n.user_id, n.absolute_expires_at;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Resolve a presented token, and record the activity.
-- ---------------------------------------------------------------------------------------------
--
-- Valid means: not revoked, idle and absolute expiry both in the future, user active. Activity
-- moves the idle expiry to `now + 12 h`, capped by the absolute expiry, which never moves.
--
-- The write is skipped when it would advance the idle expiry by less than a minute, so a burst of
-- requests is one write rather than one per request. That only ever makes the stored idle expiry
-- *earlier* than the ideal, by under a minute — never later — so the 12-hour guarantee holds
-- exactly, with no unaccounted grace.
CREATE FUNCTION app.resolve_session(
  p_token_hash bytea
) RETURNS TABLE (session_id uuid, user_id uuid, idle_expires_at timestamptz,
                 absolute_expires_at timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz;
BEGIN
  -- Lock the owning user row (FOR SHARE conflicts with a concurrent disable's UPDATE), mirroring
  -- `rotate_session`: without it a disable committing mid-call lets one stale resolution through.
  PERFORM 1
  FROM public.sessions s JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash FOR SHARE OF u;

  -- Fresh DB clock obtained after acquiring the lock
  v_now := clock_timestamp();

  RETURN QUERY
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
        >= interval '60 seconds'
  RETURNING s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > v_now
    AND s.absolute_expires_at > v_now
    AND u.status = 'active';
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Sign out: revoke the presented session and erase its provider tokens.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.revoke_session(
  p_token_hash bytea
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  UPDATE public.sessions s
  SET revoked_at = v_now, revocation_reason = 'signed_out',
      provider_tokens_sealed = NULL, provider_tokens_key_id = NULL
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL;
  RETURN FOUND;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Convergent cleanup: databases migrated at an earlier revision of this file still contain the
-- caller-clock overloads (`p_now timestamptz`), `app.session_clock` and `session_clock_policy`.
-- PostgreSQL treats the new signatures as additional overloads, so without these drops the old
-- callable paths — and their caller-supplied-time primitive — would survive on upgraded databases.
-- All no-ops on a fresh build.
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, timestamptz);
DROP FUNCTION IF EXISTS app.consume_sign_in(bytea, bytea, timestamptz);
DROP FUNCTION IF EXISTS app.begin_session(text, bytea, uuid, bytea, text, bytea, timestamptz);
DROP FUNCTION IF EXISTS app.rotate_session(bytea, bytea, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS app.resolve_session(bytea, timestamptz);
DROP FUNCTION IF EXISTS app.revoke_session(bytea, timestamptz);
DROP FUNCTION IF EXISTS app.session_clock(timestamptz);
DROP TABLE IF EXISTS public.session_clock_policy;

-- ---------------------------------------------------------------------------------------------
-- Execution: moin_identity only, each by exact signature. moin_app — the voice and worker role as
-- well as api's tenant pool — is revoked explicitly, so no default or earlier grant can survive.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.consume_sign_in(bytea, bytea) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.rotate_session(bytea, bytea, uuid, text) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.resolve_session(bytea) FROM PUBLIC, moin_app;
REVOKE ALL ON FUNCTION app.revoke_session(bytea) FROM PUBLIC, moin_app;

GRANT EXECUTE ON FUNCTION app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.consume_sign_in(bytea, bytea) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.rotate_session(bytea, bytea, uuid, text) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.resolve_session(bytea) TO moin_identity;
GRANT EXECUTE ON FUNCTION app.revoke_session(bytea) TO moin_identity;
