-- 0073 — delivery tracking, retries and dedup (P14.07.01).
--
-- `notification_deliveries` is a TENANT table (RLS + FORCE): one row per
-- (notification, channel, attempt) — provider IDs and statuses per channel,
-- bounded retries with backoff, redelivery deduped on the idempotency key
-- (P14.07.03). Payload refs are ID-only (INV-12).

CREATE TABLE notification_deliveries (
  organisation_id uuid NOT NULL,
  id              uuid NOT NULL PRIMARY KEY,
  notification_id uuid NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('inapp', 'email', 'sms')),
  attempt         integer NOT NULL CHECK (attempt >= 0),
  status          text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dlq')),
  provider_id     text CHECK (provider_id IS NULL OR length(btrim(provider_id)) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 160),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key),
  FOREIGN KEY (organisation_id) REFERENCES organisations (id) ON DELETE CASCADE,
  -- Composite leg to notifications (same-tenant only): a cross-tenant
  -- notification id dies as 23503 — RLS alone cannot prevent the pointer.
  FOREIGN KEY (organisation_id, notification_id) REFERENCES notifications (organisation_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE notification_deliveries IS 'P14.07: one row per (notification, channel, attempt); bounded retries, redelivery dedup on the idempotency key.';

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_tenant ON notification_deliveries
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO moin_app;
