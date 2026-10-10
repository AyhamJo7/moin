-- 0041 — tasks full shape (P07.06.01, P07.06.03).
-- migration-check: allow create-index-blocking because every index here is on the tasks table
-- extended by this same migration (new nullable columns, empty backfill), so each is new and empty.
--
-- 0025 created the MINIMAL table the membership trigger needs and promised this shape would
-- arrive as new nullable columns, never by touching those. So: `type` (what kind of work),
-- `priority`, `due_at` (UTC instant; the tenant time zone in `organisations.time_zone` renders
-- it, storage never shifts), `conversation_id` (the interaction this task came from, if any),
-- `idempotency_key` (system-created tasks are unique per interaction + type), `snoozed_until`
-- (snooze parks the task without changing its status). All nullable: every 0025 row still
-- satisfies the table, and the trigger (which writes assignee/version only) is unaffected.
--
-- The state machine lives in the service (compare-and-hold on status + version); the DB keeps
-- the closed CHECK sets. One system task per interaction and type: partial unique on
-- (organisation_id, conversation_id, type) WHERE the key columns are all NOT NULL.

ALTER TABLE tasks
  ADD COLUMN type text CHECK (
    type IN ('callback', 'review', 'booking', 'follow_up', 'general')
  ),
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  ),
  ADD COLUMN due_at timestamptz,
  ADD COLUMN conversation_id uuid,
  ADD COLUMN idempotency_key text,
  ADD COLUMN snoozed_until timestamptz;

ALTER TABLE tasks ADD FOREIGN KEY (organisation_id, conversation_id)
  REFERENCES conversations (organisation_id, id) ON DELETE SET NULL (conversation_id);

-- One system task per interaction and type: rows that carry all three collide, human rows
-- (NULL conversation or NULL type) never do.
CREATE UNIQUE INDEX tasks_system_interaction_unique_idx
  ON tasks (organisation_id, conversation_id, type)
  WHERE conversation_id IS NOT NULL AND type IS NOT NULL;

-- Idempotency keys are per-tenant unique when present (system task creation retries).
-- Plain UNIQUE (not partial): ON CONFLICT needs an arbiter the partial predicate cannot serve,
-- and a NULL key never conflicts anyway (NULLs are never equal).
CREATE UNIQUE INDEX tasks_idempotency_unique_idx ON tasks (organisation_id, idempotency_key);

CREATE INDEX tasks_due_idx ON tasks (organisation_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX tasks_status_idx ON tasks (organisation_id, status);

COMMENT ON COLUMN tasks.type IS 'Kind of work (callback/review/booking/follow_up/general). NULL on pre-P07.06 rows; system tasks always set it.';
COMMENT ON COLUMN tasks.priority IS 'low | normal | high | urgent. Defaults normal.';
COMMENT ON COLUMN tasks.due_at IS 'UTC instant the task is due. Rendered in the tenant time zone (organisations.time_zone); storage never shifts.';
COMMENT ON COLUMN tasks.conversation_id IS 'The interaction this task came from, if any. SET NULL keeps the task when its conversation is erased.';
COMMENT ON COLUMN tasks.idempotency_key IS 'System-task creation key (interaction + type at the writer). Per-tenant unique when present.';
COMMENT ON COLUMN tasks.snoozed_until IS 'UTC instant the snooze lifts. Parking, not a status: the machine rung is unchanged.';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers and counters only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('task.create', 'task_type', 'count', 'task type as opaque marker (0..4 in CHECK order, 9 when NULL); no title'),
  ('task.status', 'to_status', 'count', 'new status rung as opaque marker (0..4 in CHECK order); no payload'),
  ('task.assign', 'assigned', 'count', '1 when a user id was set, 0 when cleared to unassigned; no user id'),
  ('task.snooze', 'snoozed', 'count', 'always 1 (a snooze parked the task); the instant itself is task data, not audit data')
ON CONFLICT (operation, argument_key) DO NOTHING;
