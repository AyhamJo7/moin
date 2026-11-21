-- 0085 — the disclosure each call was given, and separate evidence that it was played
-- (ROADMAP S1; P11.02.04, INV-03).
-- migration-check: allow create-index-blocking because every index here belongs to a table created earlier in this same migration, so it is new and empty.
--
-- `call_disclosures` is written by the inbound webhook in the same transaction as the call row:
-- which disclosure template (by version) the TwiML carried. One per call; a retried webhook
-- finds it and writes nothing, so the version kept is the one first issued.
--
-- `call_disclosure_playbacks` is evidence from the relay session, kept apart because issuing a
-- disclosure and the caller hearing it are different facts. `confirmed`: a caller turn arrived,
-- which the provider sends only after the non-interruptible greeting has finished. `interrupted`:
-- the session was authenticated and closed before any caller turn. No row: no session ever
-- authenticated, so nothing was played (absent).
--
-- Both are append-only for the runtime role (SELECT, INSERT): evidence is never rewritten.

CREATE TABLE call_disclosures (
  organisation_id    uuid        NOT NULL,
  id                 uuid        NOT NULL PRIMARY KEY,
  call_id            uuid        NOT NULL,
  disclosure_version text        NOT NULL CHECK (disclosure_version ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, call_id),
  FOREIGN KEY (organisation_id, call_id) REFERENCES calls (organisation_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE call_disclosures IS 'The disclosure template version a call was issued (INV-03, P11.02.04). One per call, first issue wins.';

CREATE TABLE call_disclosure_playbacks (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  call_id         uuid        NOT NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('confirmed', 'interrupted')),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, call_id),
  FOREIGN KEY (organisation_id, call_id) REFERENCES call_disclosures (organisation_id, call_id) ON DELETE CASCADE
);

COMMENT ON TABLE call_disclosure_playbacks IS 'Relay evidence that the issued disclosure was played (INV-03). confirmed | interrupted; no row = no session, nothing played.';

SELECT app.apply_tenant_rls('call_disclosures');
SELECT app.apply_tenant_rls('call_disclosure_playbacks');

REVOKE ALL ON TABLE call_disclosures, call_disclosure_playbacks
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT ON call_disclosures, call_disclosure_playbacks TO moin_app;
