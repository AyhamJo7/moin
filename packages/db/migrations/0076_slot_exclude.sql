-- 0076 — slot-hold exclusion + audit allowlist (P20.05/06 SELL rework).
--
-- Real double-book prevention at the database level: btree_gist EXCLUDE on
-- (resource_id, tstzrange) blocks overlapping holds per tenant even under
-- concurrency (LG-B01). Audit allowlist rows for the booking operations
-- (counts/ids only, INV-12).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE slot_holds
  ADD CONSTRAINT slot_holds_no_overlap
  EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&);

CREATE TABLE booking_confirms (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  hold_id         uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 160),
  status          text NOT NULL CHECK (status IN ('confirmed', 'refused')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key)
);

COMMENT ON TABLE booking_confirms IS 'P20.06 SELL: confirm markers keyed by idempotency — retry-safe outcomes.';

ALTER TABLE booking_confirms ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_confirms FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_confirms_tenant ON booking_confirms
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT ON booking_confirms TO moin_app;

INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('booking.hold', 'holds', 'count', 'one hold placed; opaque marker, no slot detail'),
  ('booking.hold', 'refused', 'count', 'one hold refused on overlap; opaque marker'),
  ('booking.confirm', 'confirmed', 'count', 'one hold confirmed; opaque marker, no slot detail'),
  ('booking.confirm', 'refused', 'count', 'one confirm refused (expired/missing); opaque marker')
ON CONFLICT (operation, argument_key) DO NOTHING;
