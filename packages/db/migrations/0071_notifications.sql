-- 0071 — notification model and preferences (P14.01.01).
-- migration-check: allow create-index-blocking because the index is on a table
-- created earlier in this same migration, so it is new and empty.
--
-- `notifications` is a TENANT table (RLS + FORCE): one row per domain-event
-- trigger, idempotent per dedup_key (e.g. `task:{id}:urgent`) — repeats keep
-- the row, never double-notify. `notification_prefs` is a TENANT table
-- (RLS + FORCE): one row per user — channels per priority, quiet hours, and
-- the urgent-bypass contact flag (P14.01.03). Content is ID references only
-- (INV-12): channel renderers re-fetch the minimal fields per channel.

CREATE TABLE notifications (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  dedup_key       text NOT NULL CHECK (length(btrim(dedup_key)) BETWEEN 1 AND 160),
  priority        text NOT NULL CHECK (priority IN ('routine', 'urgent')),
  ref_kind        text NOT NULL CHECK (length(btrim(ref_kind)) BETWEEN 1 AND 80),
  ref_id          uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, dedup_key),
  UNIQUE (organisation_id, id)
);

COMMENT ON TABLE notifications IS 'P14.01: one row per domain-event trigger; idempotent per dedup_key. ID-only refs (INV-12).';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant ON notifications
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT ON notifications TO moin_app;

CREATE TABLE notification_prefs (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  user_id         uuid NOT NULL,
  channels        text[] NOT NULL DEFAULT '{inapp}',
  urgent_only     boolean NOT NULL DEFAULT false,
  quiet_from      time,
  quiet_to        time,
  urgent_bypass   boolean NOT NULL DEFAULT false,
  UNIQUE (organisation_id, user_id),
  UNIQUE (organisation_id, id)
);

COMMENT ON TABLE notification_prefs IS 'P14.01: per-user channels per priority, quiet hours, urgent-bypass flag (configured contacts only).';

ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_prefs_tenant ON notification_prefs
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON notification_prefs TO moin_app;
