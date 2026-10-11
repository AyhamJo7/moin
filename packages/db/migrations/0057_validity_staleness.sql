-- 0057 — knowledge validity, staleness and re-verification (P09.06).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What this adds (additive only — no column rewrites, no backfills)
--
-- 1. `reverify_after interval` on knowledge_versions (nullable: no deadline).
--    The service fills it from per-category defaults when a version is created
--    without an explicit value — the column itself stays nullable so pre-0057
--    rows need no backfill (NULL = no deadline, same as before).
-- 2. `suspended boolean` on knowledge_items (NOT NULL DEFAULT false): the
--    overdue-sensitive escalation path (P09.06.02). Set only by the service
--    sweep; cleared on the next approval. Default false keeps every existing
--    row servable — no behaviour change for rows that predate this column.
-- 3. `knowledge_reverify_queue`: one row per item due for re-verification.
--    Idempotency lives HERE (UNIQUE (organisation_id, item_id)), not in task
--    idempotency keys — the sweep upserts the queue row, then creates at most
--    one open task per queue row. Re-running the sweep never duplicates work.
--
-- Validity (valid_until) already exists as a DATE on knowledge_versions (0052)
-- and needs no schema change: enforcement lands in the service layer
-- (getLiveVersion + findAnswer filters), proven by the retrieval tests.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE via
-- apply_tenant_rls (the 0052 pattern — ALTERs inherit nothing here because this
-- IS a new table, so apply explicitly).

ALTER TABLE knowledge_versions
  ADD COLUMN reverify_after interval
    CHECK (reverify_after IS NULL OR reverify_after > interval '0 seconds');

ALTER TABLE knowledge_items
  ADD COLUMN suspended boolean NOT NULL DEFAULT false;

-- FAQ cards predate validity (0055 has no valid_until): same expiry rule as
-- knowledge versions (P09.06.01) — expired cards never served. Nullable: no
-- backfill (NULL = no expiry, as before). reverify_after mirrors the version
-- column so the same sweep logic covers cards; the deadline anchor is
-- updated_at (bumped on every card update — the card's "last verified").
ALTER TABLE faq_cards
  ADD COLUMN valid_until date,
  ADD COLUMN reverify_after interval
    CHECK (reverify_after IS NULL OR reverify_after > interval '0 seconds');

COMMENT ON COLUMN faq_cards.valid_until IS 'Expiry date (P09.06.01): expired cards never served, regardless of sensitivity. NULL = no expiry (pre-0057 cards unaffected).';
COMMENT ON COLUMN faq_cards.reverify_after IS 'Re-verification deadline as an interval after updated_at (P09.06). NULL = no deadline.';

COMMENT ON COLUMN knowledge_versions.reverify_after IS 'Re-verification deadline as an interval after the version went live (P09.06). NULL = no deadline. Service-filled from per-category defaults when unset; pre-0057 rows stay NULL (no deadline, as before).';
COMMENT ON COLUMN knowledge_items.suspended IS 'Overdue-sensitive escalation flag (P09.06.02): a sensitive item past its reverify deadline stops serving until re-approved. Set only by the reverify sweep; cleared on next approval. Default false — pre-0057 rows unaffected.';

CREATE TABLE knowledge_reverify_queue (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  item_id         uuid NOT NULL,
  due_at          timestamptz NOT NULL,
  -- Bare uuid, deliberately NOT a database FK (ROUND-1 P2-2): tasks carries
  -- UNIQUE (organisation_id, id) but its PRIMARY KEY is the bare id, so a
  -- composite FK is inexpressible and a bare-uuid FK would admit cross-tenant
  -- task ids. Tenant isolation holds because every write and read runs inside
  -- withTenant under FORCE RLS — the sweep writes task_id from a task row it
  -- just created in the SAME tenant transaction, and the cross-tenant test
  -- below pins that no foreign row is ever visible. See also the
  -- application-level assertion in staleness.integration.test.ts
  -- ('queue task ids resolve inside the tenant').
  task_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- One queue row per item: re-running the sweep upserts, never duplicates.
  UNIQUE (organisation_id, item_id),
  FOREIGN KEY (organisation_id, item_id) REFERENCES knowledge_items (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX knowledge_reverify_queue_due_idx
  ON knowledge_reverify_queue (organisation_id, due_at);

SELECT app.apply_tenant_rls('knowledge_reverify_queue');

REVOKE ALL ON TABLE knowledge_reverify_queue
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_reverify_queue TO moin_app;

COMMENT ON TABLE knowledge_reverify_queue IS 'Re-verification queue (P09.06.02): one row per item past its reverify deadline. task_id links the Wissen-pruefen task; NULL until created. Append-only per item (upsert); erasure runs privileged.';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never bodies.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.reverify_task', 'version_no', 'count', 're-verification task version marker; no ids or content'),
  ('knowledge.suspend', 'version_no', 'count', 'suspension marker; no ids or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
