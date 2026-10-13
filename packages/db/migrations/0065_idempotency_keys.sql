-- 0065 — idempotency keys (P08.04.01, ADR-0007).
--
-- `idempotency_keys` is a TENANT table (RLS + FORCE): one row per
-- (organisation, operation, key). The stored response replays for 24 h
-- (P08.04.01); the retention hook is expires_at (P16 owns the purge job).
-- Same key + different body → 422 at the service (request_hash compare);
-- concurrent same key → one executes (row lock), the other waits or 409s.

CREATE TABLE idempotency_keys (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  operation       text NOT NULL CHECK (length(btrim(operation)) BETWEEN 1 AND 80),
  key             text NOT NULL CHECK (length(btrim(key)) BETWEEN 1 AND 100),
  request_hash    text NOT NULL CHECK (length(btrim(request_hash)) BETWEEN 1 AND 128),
  response        jsonb,
  status          text NOT NULL DEFAULT 'executing'
                    CHECK (status IN ('executing', 'succeeded', 'failed')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, operation, key)
);

COMMENT ON TABLE idempotency_keys IS 'P08.04: Idempotency-Key store (ADR-0007). Tenant table; stored response replays 24h. Same key + different body is 422; concurrent same key serialises on the row.';

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_tenant ON idempotency_keys
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO moin_app;
