-- 0025 — tasks (minimal): assignee tracking so member disable/remove returns work (P06.08.03).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Why a tasks table lands in P06, ahead of P07
--
-- P06.08.03 promises that disabling or removing a member returns their assignments to
-- unassigned. That promise needs a table to act on, and no tasks table exists yet (P07
-- NOT_STARTED). This migration creates the MINIMAL table the trigger needs — identity,
-- tenant, title, status, assignee — shaped so P07.06 extends it without renaming: types,
-- priorities, due dates, interaction linkage and idempotency keys arrive as new nullable
-- columns with their own constraints in the P07 migration, never by touching these.
--
-- ## Assignee is a user id, never a membership FK
--
-- `assignee_user_id` points at no row: a removed member HAS no row, and a disabled one's
-- row is refused — either way the value must survive the membership write to be cleared
-- by it. NULL is unassigned. The trigger clears by (organisation_id, user_id) equality,
-- never by joining memberships, so no cross-tenant row is expressible.
--
-- ## Status is the P07.06 machine, seeded
--
-- The CHECK set is exactly P07.06.01 (`open → in_progress → waiting → done | cancelled`);
-- no transition enforcement lives here — P07.06 owns the state machine and its tests.
-- New rows start `open`.
--
-- No audit on task rows yet: P07.10 owns governance records. The trigger writes no audit
-- row — unassignment is a consequence of the audited membership change, not an action.
--
-- No new roles, no RLS change beyond the new table's own policy. `moin_app` manages tasks
-- inside withTenant; nothing else touches this table.

CREATE TABLE tasks (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  title           text        NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  status          text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting', 'done', 'cancelled')),
  assignee_user_id uuid,
  created_by      uuid,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

CREATE INDEX tasks_assignee_idx ON tasks (organisation_id, assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;

COMMENT ON TABLE tasks IS
  'Work items (P06.08.03 minimal, P07.06 owns the full shape). Tenant rows: assignee is a bare user id (NULL = unassigned), cleared by the membership trigger on disable/remove.';

SELECT app.apply_tenant_rls('tasks');

REVOKE ALL ON TABLE tasks
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO moin_app;

-- ---------------------------------------------------------------------------------------------
-- Return-to-unassigned: a member who leaves (or is switched off) keeps no work assigned.
-- ---------------------------------------------------------------------------------------------
--
-- AFTER trigger on `memberships`: when a row is deleted, or its status leaves `active`,
-- every task assigned to that (organisation, user) is set unassigned. AFTER, so the
-- membership change is already true; FOR EACH ROW, keyed by OLD values, so the task
-- write names the exact tenant literal — no join, no subselect, no cross-tenant path.
-- Demotion (role change, still active) does NOT unassign: the person still works here.
-- Transfer-ownership demotes the actor to admin (still active) — their tasks stay, and
-- the test pins exactly that.
--
-- Lock note: the membership row is already locked by the writer; the task rows lock in
-- (organisation_id, assignee_user_id) index order per row written. Two concurrent
-- membership changes of different users never contend; of the same user they queue on
-- the membership row first (same pattern as 0016/0017 serialisation points).

CREATE FUNCTION app.unassign_member_tasks() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.tasks t
    SET assignee_user_id = NULL, updated_at = clock_timestamp(), version = version + 1
    WHERE t.organisation_id = OLD.organisation_id
      AND t.assignee_user_id = OLD.user_id
      AND t.assignee_user_id IS NOT NULL;
    RETURN OLD;
  END IF;
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE public.tasks t
    SET assignee_user_id = NULL, updated_at = clock_timestamp(), version = version + 1
    WHERE t.organisation_id = NEW.organisation_id
      AND t.assignee_user_id = NEW.user_id
      AND t.assignee_user_id IS NOT NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.unassign_member_tasks() FROM PUBLIC;

CREATE TRIGGER memberships_unassign_tasks
  AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.unassign_member_tasks();
-- Fires in replica mode too, so a session setting cannot switch it off.
ALTER TABLE memberships ENABLE ALWAYS TRIGGER memberships_unassign_tasks;
