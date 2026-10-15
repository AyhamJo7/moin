-- 0069 — feature flags + tenant overrides (P08.10.01/.02, ADR-0032).
-- migration-check: allow create-index-blocking because the index is on a table
-- created earlier in this same migration, so it is new and empty.
--
-- `feature_flag_definitions` is GLOBAL (no organisation_id, global-tables
-- register): the platform catalogue of kill switches — ai_answering,
-- faq_answering, llm_wording, transfers, sms, booking_execution (P08.10.02).
-- `tenant_flag_overrides` is a TENANT table (RLS + FORCE): per-tenant values
-- win over the global default; absent override = default applies.
-- Flag reads cache ≤ 60 s (P08.10.01) at the service; changes audit (P08.10.03).

CREATE TABLE feature_flag_definitions (
  name         text NOT NULL PRIMARY KEY CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  default_on   boolean NOT NULL,
  description  text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 280),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE feature_flag_definitions IS 'P08.10: global kill-switch catalogue (ADR-0032). Tenant values live in tenant_flag_overrides.';

INSERT INTO feature_flag_definitions (name, default_on, description) VALUES
  ('ai_answering', true, 'AI voice answering; off = deterministic capture only'),
  ('faq_answering', true, 'Approved-FAQ spoken answers; off = escalate instead'),
  ('llm_wording', true, 'LLM wording of non-sensitive passages; off = verbatim cards only'),
  ('transfers', true, 'Call transfers to staff; off = callback offers only'),
  ('sms', true, 'Outbound SMS; off = queue for operator review'),
  ('booking_execution', true, 'Booking tool execution; off = capture requests only')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE tenant_flag_overrides (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  flag_name       text NOT NULL REFERENCES feature_flag_definitions (name),
  enabled         boolean NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, flag_name)
);

COMMENT ON TABLE tenant_flag_overrides IS 'P08.10: per-tenant flag values; win over the global default. Absent row = default applies.';

CREATE INDEX tenant_flag_overrides_lookup_idx ON tenant_flag_overrides (organisation_id, flag_name);

ALTER TABLE tenant_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_flag_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_flag_overrides_tenant ON tenant_flag_overrides
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT ON feature_flag_definitions TO moin_app;
GRANT SELECT, INSERT, UPDATE ON tenant_flag_overrides TO moin_app;
