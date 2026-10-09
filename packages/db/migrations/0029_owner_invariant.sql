-- 0029 — effective-owner invariant + cascade-safe org deletion (P06.07 H1/H3).
--
-- ## What was wrong (QG-09 §5, EV-P06-070)
--
-- H1: `app.reject_last_owner_loss` counted membership rows (`role = 'owner'` AND
-- `status = 'active'`) without checking whether the owner USER is active. Disabling
-- the last owner's user account left an organisation with no usable owner. Fix: the
-- count joins `users` and requires `users.status = 'active'`. `users` is a global
-- table (no RLS), so no request_lookup marker is needed for the join.
-- H3: the trigger fired on every membership DELETE, so `DELETE FROM organisations`
-- cascading into memberships aborted with `integrity_constraint_violation` — tenant
-- deletion was unrepresentable. Fix: skip the check when `pg_trigger_depth() > 1`
-- (cascade-fired row triggers run nested; a direct membership DELETE runs at depth 1).
-- H2 (lock order) is NOT changed here: an AFTER ROW trigger cannot pre-lock — the row
-- lock is already held when it fires. The per-org advisory xact lock remains the
-- serialisation point (same pattern as 0016 §7); opposing transfers queue per org.
--
-- No signature, owner, grant or search_path change. Catalog REVIEWED_BODIES digest
-- moves to the new text (see the catalog change in this PR).

CREATE OR REPLACE FUNCTION app.reject_last_owner_loss() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_organisation uuid;
  v_owners integer;
BEGIN
  -- Cascade-fired row triggers run nested (depth > 1): the organisation itself is
  -- going away, so there is no invariant left to protect. Direct membership writes
  -- run at depth 1 and are always checked.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM set_config('app.request_lookup', 'resolve_request_context', true);
    FOR v_organisation IN
      SELECT DISTINCT o.id FROM (SELECT OLD.organisation_id AS id
                                 UNION SELECT NEW.organisation_id) o
      WHERE o.id IS NOT NULL
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext('last-owner:' || v_organisation::text));
      -- Effective owner: the membership is active AND the user account is active.
      -- `users` is global (no RLS), so the join needs no lookup marker.
      SELECT count(*) INTO v_owners
      FROM public.memberships m
      JOIN public.users u ON u.id = m.user_id
      WHERE m.organisation_id = v_organisation
        AND m.role = 'owner'
        AND m.status = 'active'
        AND u.status = 'active';
      IF v_owners = 0 THEN
        RAISE EXCEPTION 'an organisation keeps at least one active owner (P06.07.04)'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END LOOP;
    PERFORM set_config('app.request_lookup', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.request_lookup', '', true);
    RAISE;
  END;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
