-- 0064 — provider inbox and deduplication (P08.03.01/.03, ADR-0007).
-- migration-check: allow create-index-blocking because the index is on a table
-- created earlier in this same migration, so it is new and empty.
--
-- `provider_inbox` is GLOBAL (no organisation_id, global-tables register):
-- provider events arrive before tenant resolution — the mapping
-- (provider, provider_event_id) → org happens here. UNIQUE on
-- (provider, provider_event_id) is the dedup key: insert-then-ack means the
-- same delivery 3× writes one row, the losers 409 on the constraint.
-- Status is received → resolved | poisoned (DLQ end-state); payloads purge
-- after 30 days (P08.03.03, retention engine in P16 — the column is the hook).
-- moin_app INSERTs; moin_dispatcher resolves + marks; no tenant tables.

CREATE TABLE provider_inbox (
  id                uuid NOT NULL PRIMARY KEY,
  provider          text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 40),
  provider_event_id text NOT NULL CHECK (length(btrim(provider_event_id)) BETWEEN 1 AND 160),
  resolved_org      uuid REFERENCES organisations (id) ON DELETE SET NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received', 'resolved', 'poisoned')),
  poison_reason     text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  UNIQUE (provider, provider_event_id),
  CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CHECK (status <> 'poisoned' OR poison_reason IS NOT NULL)
);

COMMENT ON TABLE provider_inbox IS 'P08.03: provider event inbox (ADR-0007). Global pre-tenant table; UNIQUE(provider, provider_event_id) dedups redelivery. Payload retention 30 days.';

CREATE INDEX provider_inbox_unresolved_idx ON provider_inbox (received_at, id)
  WHERE status = 'received';

GRANT SELECT, INSERT ON provider_inbox TO moin_app;
GRANT SELECT, UPDATE ON provider_inbox TO moin_dispatcher;
