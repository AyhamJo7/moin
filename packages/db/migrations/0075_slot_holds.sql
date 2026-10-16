-- 0075 — booking slot holds (P20.05 SELL).
--
-- `slot_holds` is a TENANT table (RLS + FORCE): one row per hold — the
-- EXCLUDE constraint (btree_gist, once the extension lands with the P20.05
-- concurrency work) guarantees zero double bookings; the 2-minute TTL row
-- is swept by the timer path. This migration is the row shape + RLS +
-- composite keys; the EXCLUDE lands separately with the extension.

CREATE TABLE slot_holds (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  resource_id     uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL CHECK (ends_at > starts_at),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 160),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key)
);

COMMENT ON TABLE slot_holds IS 'P20.05 SELL: slot holds with 2-min TTL; EXCLUDE constraint rides the btree_gist work.';

ALTER TABLE slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_holds FORCE ROW LEVEL SECURITY;
CREATE POLICY slot_holds_tenant ON slot_holds
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON slot_holds TO moin_app;
