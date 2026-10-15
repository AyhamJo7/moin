-- 0062 — job envelope ledger (P08.01.01/02).
--
-- `job_runs` is the durable home of the envelope (ADR-0008): one row per
-- dispatch, keyed by the application's UUIDv7 job_id. The payload column holds
-- ID references only (P08 Security) — handlers re-read inside `withTenant`.
-- Status is a small monotonic chain (queued → claimed → succeeded | failed,
-- with dead marking the DLQ end-state); the CHECK below is the DB half of it.
--
-- Roles: moin_app INSERTs (one transaction with the business write, P08.02.01);
-- moin_dispatcher SELECTs/UPDATEs claims and history (no tenant tables).
-- Tenant rows: organisation_id NULL is allowed here for pre-tenant system work
-- (provision hand-off); every tenant-scoped row carries the composite unique.

CREATE TABLE job_runs (
  organisation_id uuid REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  type            text NOT NULL
                    CHECK (type IN ('postcall-finalise', 'notification-send', 'sweep-run',
                                    'retention-purge', 'import-structure', 'reverify-sweep')),
  version         integer NOT NULL CHECK (version > 0),
  correlation_id  uuid NOT NULL,
  trace_context   text,
  attempt         integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  not_before      timestamptz,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  queue_name      text NOT NULL CHECK (length(btrim(queue_name)) BETWEEN 1 AND 80),
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'claimed', 'succeeded', 'failed', 'dead')),
  error_code      text,
  claimed_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CHECK (status <> 'claimed' OR claimed_at IS NOT NULL),
  CHECK (status NOT IN ('succeeded', 'failed', 'dead') OR finished_at IS NOT NULL)
);

COMMENT ON TABLE job_runs IS 'P08.01: durable envelope ledger (ADR-0008). ID-only payload; handlers re-read in withTenant. Pre-tenant rows carry NULL organisation_id.';

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY job_runs_tenant ON job_runs
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON job_runs TO moin_app;
GRANT SELECT, UPDATE ON job_runs TO moin_dispatcher;
