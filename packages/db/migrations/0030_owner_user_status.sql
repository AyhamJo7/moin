-- 0030 — fire the effective-owner check on user-status flips (P06.07 H1, second half).
--
-- 0029 fixed the count (JOIN users) and the cascade path, but
-- `memberships_last_owner` fires only on membership writes. Disabling the last
-- owner's USER row never touches memberships, so the check never ran. This trigger
-- reuses the same function: it fires AFTER UPDATE OF status ON users, finds every
-- organisation where the user is an active owner, and runs the same advisory lock +
-- effective-owner count per org. Cascade depth guard inherited (users updates run at
-- depth 1 in practice).

CREATE OR REPLACE FUNCTION app.reject_last_owner_loss_on_user_status() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_organisation uuid;
  v_owners integer;
BEGIN
  -- Only a transition out of active can remove an effective owner; everything else
  -- (including re-enabling) cannot strand a tenant.
  IF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN NEW;
    END IF;
    BEGIN
      PERFORM set_config('app.request_lookup', 'resolve_request_context', true);
      FOR v_organisation IN
        SELECT DISTINCT m.organisation_id
        FROM public.memberships m
        WHERE m.user_id = OLD.id
          AND m.role = 'owner'
          AND m.status = 'active'
      LOOP
        PERFORM pg_advisory_xact_lock(hashtext('last-owner:' || v_organisation::text));
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
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.reject_last_owner_loss_on_user_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS users_last_owner ON users;

CREATE TRIGGER users_last_owner
  AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION app.reject_last_owner_loss_on_user_status();

ALTER TABLE users ENABLE ALWAYS TRIGGER users_last_owner;
