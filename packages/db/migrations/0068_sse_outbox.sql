-- 0068 — SSE replay window (P08.08.02, ADR-0009).
--
-- `sse_events` is a TENANT table (RLS + FORCE): the 15-minute replay window
-- for Last-Event-ID reconnects. The dispatcher writes one row per fan-out
-- event (org + user channel, event id, type, minimal payload refs); Valkey
-- pub/sub carries live delivery, this table carries the catch-up. Rows older
-- than 15 minutes purge (retention hook: created_at; P16 owns the job).
-- Payloads are ID references only (P08 Security) — the client re-fetches.

CREATE TABLE sse_events (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  user_id         uuid NOT NULL,
  event_id        bigint GENERATED ALWAYS AS IDENTITY,
  event_type      text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 80),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

COMMENT ON TABLE sse_events IS 'P08.08: SSE replay window (ADR-0009). 15-minute catch-up for Last-Event-ID reconnects; live delivery is Valkey pub/sub. ID-only payload.';

CREATE INDEX sse_events_replay_idx ON sse_events (organisation_id, user_id, event_id);

ALTER TABLE sse_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sse_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sse_events_tenant ON sse_events
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT ON sse_events TO moin_app;
