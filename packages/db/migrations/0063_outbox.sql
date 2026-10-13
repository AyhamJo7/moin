-- 0063 — transactional outbox (P08.02.01, ADR-0007).
-- migration-check: allow create-index-blocking because the index is on a table
-- created earlier in this same migration, so it is new and empty.
--
-- `outbox` is GLOBAL (no tenant RLS): the dispatcher crosses tenants by
-- design, but never reads tenant tables — it carries IDs, handlers re-read
-- inside `withTenant`. moin_app INSERTs only (one transaction with the
-- business write); moin_dispatcher SELECTs/UPDATEs dispatch bookkeeping.
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
  UNIQUE (organisation_id, aggregate, aggregate_id, aggregate_ver),
  CHECK (dispatched_at IS NULL OR attempts >= 0)
);

COMMENT ON TABLE outbox IS 'P08.02: transactional outbox (ADR-0007). Global table; dispatcher never reads tenant rows. ID-only payload; per-aggregate ordering via aggregate_ver at the consumer.';

CREATE INDEX outbox_undispatched_idx ON outbox (created_at, id)
  WHERE dispatched_at IS NULL;

GRANT SELECT, INSERT ON outbox TO moin_app;
GRANT SELECT, UPDATE ON outbox TO moin_dispatcher;
