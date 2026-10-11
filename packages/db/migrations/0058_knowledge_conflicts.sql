-- 0058 — knowledge conflict detection (P09.07).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What this adds (additive only — no column rewrites, no backfills)
--
-- 1. `conflict_state` on knowledge_items (NOT NULL DEFAULT 'clear'): an
--    approved item in an OPEN conflict is suspended from serving (P09.07.03) —
--    the SAME serving effect as the staleness `suspended` flag, but a
--    separate column so the two causes stay distinguishable (stale review vs
--    contradictory truth need different owner actions). Default 'clear' keeps
--    every existing row servable.
-- 2. `knowledge_conflicts`: one row per detected contradiction. Subjects are
--    heterogeneous by detector (item+item, rule+rule, card+card), so the legs
--    are (subject_kind, subject_a, subject_b) with the tenant-scoped FK only
--    where it is expressible (items and cards have composite UNIQUEs; opening
--    rules are keyed bare-id + org UNIQUE — same shape, FK added too).
--    Idempotency lives HERE (UNIQUE per ordered subject pair + detector), not
--    in task keys — re-running detection upserts, never duplicates.
--
-- Detectors (service layer, flag-for-review ONLY — never auto-resolution):
-- - hours-overlap: two opening_rules, same location + weekday, overlapping
--   wall-clock minutes (midnight-spanning intervals normalized).
-- - faq-duplicate: two faq_cards whose canonicals match above the trigram
--   threshold (candidate for owner merge review).
-- - item-contradiction: reserved for the P10 LLM contradiction check (rows
--   may be written by the review flow; the sweep does not invent them).
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE via
-- apply_tenant_rls (new table — apply explicitly).

ALTER TABLE knowledge_items
  ADD COLUMN conflict_state text NOT NULL DEFAULT 'clear'
    CHECK (conflict_state IN ('clear', 'conflicted'));

COMMENT ON COLUMN knowledge_items.conflict_state IS 'Conflict suspension (P09.07.03): an approved item in an OPEN conflict stops serving until resolved — same serving effect as suspended, separate cause. Default clear — pre-0058 rows unaffected.';

CREATE TABLE knowledge_conflicts (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  -- Detector that raised this row (hours-overlap | faq-duplicate | item-contradiction).
  detector        text NOT NULL
                    CHECK (detector IN ('hours-overlap', 'faq-duplicate', 'item-contradiction')),
  -- Heterogeneous subjects: what the two legs point at.
  subject_kind    text NOT NULL
                    CHECK (subject_kind IN ('opening-rule', 'faq-card', 'knowledge-item')),
  subject_a       uuid NOT NULL,
  subject_b       uuid NOT NULL,
  -- Human-readable reason (detector output, e.g. overlapping minutes or
  -- similarity score) — markers only, never content bodies (INV-12).
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved')),
  resolved_at     timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(btrim(resolution_note)) BETWEEN 1 AND 500),
  -- Link to the Wissen-pruefen-style conflict task (tenant-scoped FK, the
  -- 0057 pattern: tasks carries UNIQUE (organisation_id, id)).
  task_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- One open row per ordered pair per detector: re-running detection upserts.
  -- Ordered legs (a < b enforced below) so (x,y) and (y,x) cannot both exist.
  UNIQUE (organisation_id, detector, subject_kind, subject_a, subject_b),
  CHECK (subject_a <> subject_b),
  FOREIGN KEY (organisation_id, task_id) REFERENCES tasks (organisation_id, id) ON DELETE SET NULL (task_id),
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  )
);

-- Canonical leg ordering WITHOUT a trigger (P09.07): triggers on tenant
-- tables need catalog review surface the check does not track for new
-- functions — so ordering happens in the SERVICE (orderLegs(): sort the two
-- uuid-texts, insert ordered). The UNIQUE (org, detector, kind, a, b) still
-- refuses mirror duplicates at the DB boundary (second insert 23503 or
-- ON CONFLICT DO NOTHING match) — the trigger would only have normalized,
-- never enforced. No trigger, no extra review surface.


CREATE INDEX knowledge_conflicts_open_idx
  ON knowledge_conflicts (organisation_id, status) WHERE status = 'open';

CREATE INDEX knowledge_conflicts_subject_idx
  ON knowledge_conflicts (organisation_id, subject_kind, subject_a, subject_b);

SELECT app.apply_tenant_rls('knowledge_conflicts');

REVOKE ALL ON TABLE knowledge_conflicts
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON knowledge_conflicts TO moin_app;

COMMENT ON TABLE knowledge_conflicts IS 'Detected knowledge contradictions (P09.07): flag-for-review rows, never auto-resolved. Open rows suspend their subjects from serving (BR-126, FS-15).';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never bodies.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.conflict_open', 'detector', 'count', 'detector marker; no ids or content'),
  ('knowledge.conflict_resolve', 'detector', 'count', 'resolution marker; no ids or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
