-- 0067 — timers table (P08.07.01, ADR-0008).
--
-- `timers` is a TENANT table (RLS + FORCE): one row per scheduled effect —
-- task reminders, escalation acknowledgement timers (P14.05), summary expiry,
-- integration renewals. due_at is when the effect fires; lease_until +
-- attempts are the claim bookkeeping: the sweeper leases due rows with
-- SKIP LOCKED (P08.07.02), effects run once per lease, restarts re-claim
-- expired leases (rows, not schedules — P08.07.04).

CREATE TABLE timers (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  kind            text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 80),
  ref_id          uuid NOT NULL,
  due_at          timestamptz NOT NULL,
  lease_until     timestamptz,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, kind, ref_id),
  CHECK (done_at IS NULL OR lease_until IS NOT NULL)
);

COMMENT ON TABLE timers IS 'P08.07: durable timers (ADR-0008). Rows survive restarts/restores; the sweeper leases due rows SKIP LOCKED. One row per (kind, ref) — scheduling twice is a no-op.';

CREATE INDEX timers_due_idx ON timers (due_at, id)
  WHERE done_at IS NULL;

ALTER TABLE timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE timers FORCE ROW LEVEL SECURITY;
CREATE POLICY timers_tenant ON timers
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON timers TO moin_app;
GRANT SELECT, UPDATE ON timers TO moin_dispatcher;
