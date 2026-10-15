-- 0063 — transactional outbox (P08.02.01, ADR-0007).
-- migration-check: allow create-index-blocking because the index is on a table
-- created earlier in this same migration, so it is new and empty.
--
-- `outbox` is a TENANT table (RLS + FORCE, like job_runs in 0062): inserts
-- ride the business transaction under `withTenant`, and per-organisation
-- dispatch claims only its own rows. The cross-tenant sweep driver (walk all
-- tenants, one dispatch each) belongs to the worker runtime (P08.05,
-- `withSystemWork`); the dispatcher role reaches no tenant table directly.
-- Payloads are ID-only references (P08 Security); aggregate + version keep
-- per-aggregate ordering at the consumer (P08.02.04).

CREATE TABLE outbox (
  id              uuid NOT NULL PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  aggregate       text NOT NULL CHECK (length(btrim(aggregate)) BETWEEN 1 AND 80),
  aggregate_id    uuid NOT NULL,
  aggregate_ver   integer NOT NULL CHECK (aggregate_ver > 0),
  event_type      text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 80),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  dispatched_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, aggregate, aggregate_id, aggregate_ver),
  CHECK (dispatched_at IS NULL OR attempts >= 0)
);

COMMENT ON TABLE outbox IS 'P08.02: transactional outbox (ADR-0007). Tenant table; per-org dispatch under withTenant, cross-tenant sweep in P08.05. ID-only payload; per-aggregate ordering via aggregate_ver at the consumer.';

CREATE INDEX outbox_undispatched_idx ON outbox (created_at, id)
  WHERE dispatched_at IS NULL;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant ON outbox
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON outbox TO moin_app;
GRANT SELECT, UPDATE ON outbox TO moin_dispatcher;
