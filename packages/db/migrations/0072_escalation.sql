-- 0072 — escalation chains and acknowledgements (P14.05.01/.02).
--
-- `escalation_chains` is a TENANT table (RLS + FORCE): one row per urgent
-- ref — ordered contact levels with ack deadlines. `escalation_acks` is a
-- TENANT table (RLS + FORCE): one row per acknowledgement — acknowledged,
-- done, or chain-exhausted stop the chain (P14.05.03). Levels and acks are
-- ID references only (INV-12).

CREATE TABLE escalation_chains (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  ref_kind        text NOT NULL CHECK (length(btrim(ref_kind)) BETWEEN 1 AND 80),
  ref_id          uuid NOT NULL,
  level           integer NOT NULL CHECK (level >= 0),
  contact_user_id uuid NOT NULL,
  due_at          timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, ref_id, level)
);

COMMENT ON TABLE escalation_chains IS 'P14.05: ordered escalation levels per urgent ref with ack deadlines; timer-driven via P08.07.';

ALTER TABLE escalation_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_chains FORCE ROW LEVEL SECURITY;
CREATE POLICY escalation_chains_tenant ON escalation_chains
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT ON escalation_chains TO moin_app;

CREATE TABLE escalation_acks (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  ref_kind        text NOT NULL CHECK (length(btrim(ref_kind)) BETWEEN 1 AND 80),
  ref_id          uuid NOT NULL,
  state           text NOT NULL CHECK (state IN ('acknowledged', 'done', 'exhausted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, ref_id)
);

COMMENT ON TABLE escalation_acks IS 'P14.05: one row per ref — ack/done/exhausted stops the chain (P14.05.03).';

ALTER TABLE escalation_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_acks FORCE ROW LEVEL SECURITY;
CREATE POLICY escalation_acks_tenant ON escalation_acks
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT ON escalation_acks TO moin_app;
