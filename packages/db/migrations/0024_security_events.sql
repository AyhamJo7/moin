-- 0024 — security events for authentication outcomes (P06.12.02, INV-10, INV-12).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Why a second table, not audit_events
--
-- Failed logins happen with NO session and NO tenant: the audit writer requires a tenant
-- (app.current_org), and inventing one (a global tenant, a caller-supplied org) breaks the
-- tenant-scoping the whole trail is built on. So security events live in their own GLOBAL
-- table, on the global register with that reason, keyed by NOTHING linkable: event id, coarse
-- outcome, coarse reason class, truncated timestamp, and an HMAC digest of (IP or subject) for
-- counting repeat offenders without storing either (INV-12). A reader learns THAT attacks
-- happen and at WHAT rate — never who or where.
--
-- ## What is recorded, and what is not
--
-- One row per authentication OUTCOME on the guarded auth surface: sign-in accepted/refused
-- (with the coarse failure class, never the reason detail — `callback_invalid` not
-- `state_missing_or_malformed`, which would oracle hunting), step-up accepted/refused,
-- throttle refusals (from the guard's own structured log — counted here for the rate, not
-- duplicated), session revocations with reset reasons. New-device: recorded as a boolean
-- `is_new_family` on accepted sign-ins (family == session id means first session, i.e. no
-- superseded predecessor) — a heuristic, documented as such, not a device fingerprint.
--
-- NEVER recorded: IP addresses, subjects, emails, tokens, digests of tokens, user agents,
-- failure details, provider messages. The HMAC key is the same throttle key (local token key);
-- rotation orphans old digests, which fails safe (counts restart, nothing bypasses).
--
-- ## Owner notification (P06.12.02)
--
-- MFA/password changes cannot notify the owner by email until P14 owns sending (EXT-09 SES):
-- the `owner_notified` column records the obligation per security event (always FALSE until
-- P14), and the runbook stop-condition fires on it. A lie in the events table (claiming
-- sent) is worse than an honest pending flag.
--
-- No RLS (global by design, registered), tight grants: moin_app inserts + reads (the guard
-- and the writers), no UPDATE/DELETE except the migrator-owned retention cleanup (P16).

CREATE TABLE auth_security_events (
  id              uuid        NOT NULL PRIMARY KEY,
  outcome         text        NOT NULL CHECK (outcome IN ('accepted', 'refused')),
  class           text        NOT NULL CHECK (class IN ('sign_in', 'step_up', 'throttle', 'revoke', 'mfa_change', 'password_change', 'new_device')),
  reason_class    text        NOT NULL CHECK (reason_class IN ('ok', 'callback', 'provider', 'token', 'identity', 'step_up', 'unavailable', 'rate_limited', 'reset')),
  source_digest   bytea       NOT NULL CHECK (octet_length(source_digest) = 32),
  is_new_family   boolean     NOT NULL DEFAULT false,
  owner_notified  boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_security_events_class_idx ON auth_security_events (class, created_at DESC);
CREATE INDEX auth_security_events_outcome_idx ON auth_security_events (outcome, created_at DESC);

COMMENT ON TABLE auth_security_events IS
  'Authentication security events (P06.12.02). Global: outcomes before any tenant exists. Keyed by HMAC digest only — no IPs, subjects, or details (INV-12). Owner notification PENDING until P14.';

REVOKE ALL ON TABLE auth_security_events
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT ON auth_security_events TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- write_signin_event: one row per outcome, bounds-checked.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION app.write_signin_event(
  p_outcome text,
  p_class text,
  p_reason_class text,
  p_source_digest bytea,
  p_is_new_family boolean DEFAULT false
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'refused') THEN
    RAISE EXCEPTION 'outcome must be accepted or refused' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_class IS NULL OR p_class NOT IN ('sign_in', 'step_up', 'throttle', 'revoke', 'mfa_change', 'password_change', 'new_device') THEN
    RAISE EXCEPTION 'unknown security event class' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason_class IS NULL OR p_reason_class NOT IN ('ok', 'callback', 'provider', 'token', 'identity', 'step_up', 'unavailable', 'rate_limited', 'reset') THEN
    RAISE EXCEPTION 'unknown reason class' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source_digest IS NULL OR octet_length(p_source_digest) <> 32 THEN
    RAISE EXCEPTION 'source must be a 32-byte digest' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.auth_security_events
    (id, outcome, class, reason_class, source_digest, is_new_family)
    VALUES (gen_random_uuid(), p_outcome, p_class, p_reason_class, p_source_digest,
            COALESCE(p_is_new_family, false));
END
$$;

REVOKE ALL ON FUNCTION app.write_signin_event(text, text, text, bytea, boolean)
  FROM PUBLIC, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT EXECUTE ON FUNCTION app.write_signin_event(text, text, text, bytea, boolean) TO moin_app;
