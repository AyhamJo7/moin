-- 0043 — appointment and reservation requests (P07.08.01).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## A request, never a booking (INV-05)
--
-- There is deliberately NO confirmed/booked state in this machine: confirming a booking is a
-- commitment, and commitments need a verified tool success (INV-05) that does not exist in the
-- pilot. The request lifecycle is open → confirmed_by_staff | declined, with confirmed_by_staff
-- meaning "staff said yes and told the guest" — a staff action recorded with who confirmed and
-- how the guest was informed — never "the slot is booked". Conversion to a real booking is a
-- P20 stub column (`converted_to_booking_ref`, opaque external reference or NULL): setting it
-- records that a later system took over, it does not confirm anything itself.
--
-- Window is a tstzrange (overlap checks arrive with scheduling, P08/P20); party size and service
-- are bounded plain columns; notes are free text (PII-classified, hard delete).
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML (no DELETE:
-- requests are history like interactions — staff decline, never erase; erasure runs privileged).

CREATE TABLE appointment_requests (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  contact_id      uuid,
  conversation_id uuid,
  kind            text        NOT NULL
                    CHECK (kind IN ('appointment', 'reservation')),
  status          text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'confirmed_by_staff', 'declined')),
  -- Who on staff confirmed, and how the guest was told (P07.08.02). Mandatory exactly when
  -- confirmed_by_staff (CHECK coupling): an anonymous confirmation is not a confirmation.
  confirmed_by    uuid,
  informed_via    text        CHECK (
                    informed_via IN ('call', 'sms', 'email', 'in_person', 'other')
                  ),
  "window"          tstzrange,
  party_size      integer     CHECK (party_size IS NULL OR party_size BETWEEN 1 AND 500),
  service         text        CHECK (service IS NULL OR length(btrim(service)) BETWEEN 1 AND 120),
  notes           text,
  -- P20 stub: opaque external booking reference once a later system takes over. NULL in pilot.
  converted_to_booking_ref text,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'confirmed_by_staff' AND confirmed_by IS NOT NULL AND informed_via IS NOT NULL)
    OR (status <> 'confirmed_by_staff' AND confirmed_by IS NULL AND informed_via IS NULL)
  ),
  CHECK (lower("window") IS NULL OR lower("window") < upper("window"))
);

CREATE INDEX appointment_requests_contact_idx
  ON appointment_requests (organisation_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX appointment_requests_status_idx ON appointment_requests (organisation_id, status);

COMMENT ON TABLE appointment_requests IS 'Guest requests (P07.08). A request, never a booking: no confirmed/booked state exists (INV-05). Conversion to a real booking is a P20 stub column.';
COMMENT ON COLUMN appointment_requests.confirmed_by IS 'Staff user id who confirmed. Mandatory exactly when confirmed_by_staff.';
COMMENT ON COLUMN appointment_requests.informed_via IS 'How the guest was told (call/sms/email/in_person/other). Mandatory exactly when confirmed_by_staff.';
COMMENT ON COLUMN appointment_requests."window" IS 'Requested time "window" (tstzrange, UTC). Overlap enforcement arrives with scheduling (P08/P20).';
COMMENT ON COLUMN appointment_requests.converted_to_booking_ref IS 'P20 stub: opaque external booking reference. NULL in pilot; setting it records handover, never confirmation.';

SELECT app.apply_tenant_rls('appointment_requests');

REVOKE ALL ON TABLE appointment_requests
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON appointment_requests TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only, no notes/service.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('request.create', 'kind', 'count', 'request kind as opaque marker (0=appointment,1=reservation); no payload'),
  ('request.status', 'to_status', 'count', 'new status rung as opaque marker (0..2 in CHECK order); no payload'),
  ('request.convert', 'converted', 'count', 'always 1 (handover recorded); the external ref itself is the target-adjacent id, not an arg')
ON CONFLICT (operation, argument_key) DO NOTHING;
