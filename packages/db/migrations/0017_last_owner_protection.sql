-- 0017 — last-owner protection (P06.07.04, INV-01).
--
-- An organisation always has at least one active owner. The application will refuse to remove,
-- demote or disable the last one (P06.08 service checks), but a check in the application alone
-- is a convention every future writer must remember — including an operator's psql. This trigger
-- is the structural backstop: any UPDATE or DELETE on `memberships` that would leave the
-- organisation with no active owner fails with `integrity_constraint_violation`.
--
-- What counts as "an owner": `role = 'owner'` AND `status = 'active'`. A disabled or suspended
-- owner does not count (they cannot act), so disabling the last active owner fails the same way
-- removing them does. Re-pointing a row at another user (`user_id` change) counts the new state.
--
-- AFTER trigger, so the row is already changed and the count sees the new truth. The check is one
-- query per changed organisation (distinct organisation_ids in the statement's new+old rows —
-- row-level triggers cannot see the statement set, so this loops the two ids of the current row,
-- which covers single-row writes; multi-row statements that empty two organisations at once are
-- refused per-row as each organisation hits zero... a single statement removing the last owners
-- of TWO organisations passes row by row? No: AFTER ROW fires after each row, and the count sees
-- committed + current-statement changes, so the second organisation's zero is visible when its
-- row fires. Correct for any statement shape.
--
-- No new grants, no new roles, no RLS change: a trigger function owned by the migrator, firing
-- ALWAYS like every other guard in this schema.

CREATE FUNCTION app.reject_last_owner_loss() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_organisation uuid;
  v_owners integer;
BEGIN
  FOR v_organisation IN
    SELECT DISTINCT o.id FROM (SELECT OLD.organisation_id AS id
                               UNION SELECT NEW.organisation_id) o
    WHERE o.id IS NOT NULL
  LOOP
    SELECT count(*) INTO v_owners
    FROM public.memberships m
    WHERE m.organisation_id = v_organisation
      AND m.role = 'owner'
      AND m.status = 'active';
    IF v_owners = 0 THEN
      RAISE EXCEPTION 'an organisation keeps at least one active owner (P06.07.04)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.reject_last_owner_loss() FROM PUBLIC;

CREATE TRIGGER memberships_last_owner
  AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.reject_last_owner_loss();
-- Fires in replica mode too, so a session setting cannot switch it off.
ALTER TABLE memberships ENABLE ALWAYS TRIGGER memberships_last_owner;
