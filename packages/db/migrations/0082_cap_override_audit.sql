-- 0082 — every change to the Early Access cap is an audited override (P06.04.03, INV-10;
-- independent acceptance read of 3510fea, MEDIUM F1).
-- migration-check: allow create-index-blocking because no index is created on a populated table here: the override table is new in this migration and empty.
-- migration-check: allow truncate because nothing is truncated: the word appears only in a BEFORE TRUNCATE trigger that refuses truncation of the new override table.
--
-- ## What was wrong
--
-- PLAN: "override needs a founder-signed flag change, audited". 0006 made the migration the
-- override ("reviewed in a pull request, merged by the founder, recorded in the history") and
-- recorded nothing else. A migration that ran `UPDATE provisioning_limits SET early_access_cap = 6`
-- raised the cap with no audit row, no actor, no reason and no approval reference, and the sixth
-- paid tenant then provisioned. The runtime roles were already refused the write (no privilege);
-- the gap was the trusted migration authority.
--
-- ## The change
--
-- * `provisioning_limit_overrides` is an append-only global table (the cap is not tenant data, so
--   the tenant audit chain cannot hold it): old and new cap, old and new accepted counter, the
--   reason, the actor, the founder-approval reference and the transaction that made the change.
--   Updates, deletes and truncation are refused by triggers that fire even under
--   `session_replication_role = replica`; no runtime role has any privilege on it.
-- * A trigger on `provisioning_limits` refuses any change of `early_access_cap`, and any decrease
--   of `accepted_paid_early_access` (a counter reset raises the effective cap just the same),
--   unless an override row for exactly that change was written in the SAME transaction. A row
--   from an earlier transaction authorises nothing.
-- * `app.override_early_access_cap` is the one reviewed way to make the change: it validates the
--   reason, actor and approval reference, writes the override row and updates the limits in one
--   call. A migration that wants to raise the cap calls it with the founder's approval reference.
--   EXECUTE is withheld from every runtime role.
--
-- The normal path is untouched: `provision_tenant` only increments the counter, which the trigger
-- allows, and the runtime roles still have no write privilege on `provisioning_limits`.

CREATE TABLE provisioning_limit_overrides (
  id            uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  txid          bigint      NOT NULL DEFAULT txid_current(),
  old_cap       integer     NOT NULL CHECK (old_cap >= 0),
  new_cap       integer     NOT NULL CHECK (new_cap >= 0),
  old_counter   integer     NOT NULL CHECK (old_counter >= 0),
  new_counter   integer     NOT NULL CHECK (new_counter >= 0),
  reason        text        NOT NULL CHECK (length(btrim(reason)) >= 8),
  actor         text        NOT NULL CHECK (length(btrim(actor)) >= 1 AND length(actor) <= 200),
  approval_ref  text        NOT NULL CHECK (length(btrim(approval_ref)) >= 8 AND length(approval_ref) <= 500),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX provisioning_limit_overrides_txid_idx ON provisioning_limit_overrides (txid);

COMMENT ON TABLE provisioning_limit_overrides IS
  'Append-only record of every change to the Early Access cap or a reset of its counter: old and new values, reason, actor, founder-approval reference (P06.04.03). Global; no runtime role has any privilege.';

REVOKE ALL ON TABLE provisioning_limit_overrides
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

CREATE FUNCTION app.reject_override_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'provisioning limit overrides are append-only' USING ERRCODE = 'integrity_constraint_violation';
END
$$;

REVOKE ALL ON FUNCTION app.reject_override_mutation() FROM PUBLIC;

CREATE TRIGGER provisioning_limit_overrides_immutable
  BEFORE UPDATE OR DELETE ON provisioning_limit_overrides
  FOR EACH ROW EXECUTE FUNCTION app.reject_override_mutation();
CREATE TRIGGER provisioning_limit_overrides_no_truncate
  BEFORE TRUNCATE ON provisioning_limit_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_override_mutation();
ALTER TABLE provisioning_limit_overrides ENABLE ALWAYS TRIGGER provisioning_limit_overrides_immutable;
ALTER TABLE provisioning_limit_overrides ENABLE ALWAYS TRIGGER provisioning_limit_overrides_no_truncate;

-- One override record authorises exactly one guarded change. `overrides_applied` counts the
-- records the limits row has consumed; a guarded change needs a record it has not consumed yet,
-- written in this transaction, as the newest record, for exactly this change, and consumes every
-- record up to it. A second change in the same transaction therefore needs a second record: a
-- reset, a provisioning and a plain reset to the same values cannot ride on one approval.
ALTER TABLE provisioning_limits ADD COLUMN overrides_applied bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN provisioning_limits.overrides_applied IS
  'How many override records this row has consumed; maintained by the guard trigger only (P06.04.03).';

CREATE FUNCTION app.require_limit_override() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_total bigint;
  v_latest public.provisioning_limit_overrides%ROWTYPE;
BEGIN
  IF NEW.early_access_cap IS DISTINCT FROM OLD.early_access_cap
     OR NEW.accepted_paid_early_access < OLD.accepted_paid_early_access THEN
    SELECT count(*) INTO v_total FROM public.provisioning_limit_overrides;
    SELECT * INTO v_latest FROM public.provisioning_limit_overrides
      ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_total <= OLD.overrides_applied
       OR v_latest.txid IS DISTINCT FROM txid_current()
       OR v_latest.old_cap IS DISTINCT FROM OLD.early_access_cap
       OR v_latest.new_cap IS DISTINCT FROM NEW.early_access_cap
       OR v_latest.old_counter IS DISTINCT FROM OLD.accepted_paid_early_access
       OR v_latest.new_counter IS DISTINCT FROM NEW.accepted_paid_early_access THEN
      RAISE EXCEPTION
        'changing the Early Access cap or resetting its counter needs its own unused override record written in the same transaction (app.override_early_access_cap, P06.04.03)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW.overrides_applied := v_total;
  ELSIF NEW.overrides_applied IS DISTINCT FROM OLD.overrides_applied THEN
    RAISE EXCEPTION 'overrides_applied is maintained by the override guard only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.require_limit_override() FROM PUBLIC;

CREATE TRIGGER provisioning_limits_require_override
  BEFORE UPDATE ON provisioning_limits
  FOR EACH ROW EXECUTE FUNCTION app.require_limit_override();
ALTER TABLE provisioning_limits ENABLE ALWAYS TRIGGER provisioning_limits_require_override;

-- The limits row cannot be removed and put back with other values: delete and truncate are
-- refused for every role, and the singleton key refuses a second row.
CREATE FUNCTION app.reject_limits_removal() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'provisioning_limits cannot be deleted or truncated (P06.04.03)'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

REVOKE ALL ON FUNCTION app.reject_limits_removal() FROM PUBLIC;

CREATE TRIGGER provisioning_limits_no_delete
  BEFORE DELETE ON provisioning_limits
  FOR EACH ROW EXECUTE FUNCTION app.reject_limits_removal();
CREATE TRIGGER provisioning_limits_no_truncate
  BEFORE TRUNCATE ON provisioning_limits
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_limits_removal();
ALTER TABLE provisioning_limits ENABLE ALWAYS TRIGGER provisioning_limits_no_delete;
ALTER TABLE provisioning_limits ENABLE ALWAYS TRIGGER provisioning_limits_no_truncate;

CREATE FUNCTION app.override_early_access_cap(
  p_new_cap integer,
  p_new_counter integer,
  p_reason text,
  p_actor text,
  p_approval_ref text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_old public.provisioning_limits%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_new_cap IS NULL OR p_new_cap < 0 THEN
    RAISE EXCEPTION 'the new cap must be a non-negative integer' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_old FROM public.provisioning_limits WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provisioning_limits is empty' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- A NULL counter means "leave it alone"; the record then states the unchanged value.
  INSERT INTO public.provisioning_limit_overrides
    (old_cap, new_cap, old_counter, new_counter, reason, actor, approval_ref)
    VALUES (v_old.early_access_cap, p_new_cap, v_old.accepted_paid_early_access,
            COALESCE(p_new_counter, v_old.accepted_paid_early_access), p_reason, p_actor,
            p_approval_ref)
    RETURNING id INTO v_id;
  UPDATE public.provisioning_limits
    SET early_access_cap = p_new_cap,
        accepted_paid_early_access = COALESCE(p_new_counter, v_old.accepted_paid_early_access),
        reason = p_reason,
        updated_at = now()
    WHERE id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION app.override_early_access_cap(integer, integer, text, text, text)
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;
